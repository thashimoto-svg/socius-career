import type { User } from "firebase/auth";
import { LOAD_TIMEOUT_MS, withTimeout } from "./with-timeout";

/**
 * Calls to our own route handlers.
 *
 * Firebase Auth keeps its session in the client SDK rather than in cookies, so
 * a fetch carries no identity unless we attach one. Every call sends a fresh
 * ID token; `getIdToken()` returns the cached one until it is close to expiry,
 * so this is not a round trip per request.
 */
export class ApiError extends Error {
  readonly status: number;
  /**
   * Whether sending the same request again could work.
   *
   * False for the daily cap: offering 再送 for something that will fail the
   * same way until the date changes is the dead end 「AIの応答に失敗しました」
   * used to be. Routes opt out explicitly; everything else is worth retrying.
   */
  readonly retryable: boolean;

  constructor(status: number, message: string, retryable = true) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

type ErrorPayload = { error?: string; retryable?: boolean } | null;

const FALLBACK_ERROR = "通信に失敗しました。時間をおいてもう一度お試しください。";

/**
 * Deadlines, because a route handler that never answers is 「考えています…」
 * forever.
 *
 * There are two different waits here and they deserve different numbers. A
 * whole reply is generated before /api/extract sends anything, so its budget
 * has to cover the model thinking. /api/chat streams, so the first byte should
 * be quick — and once it is coming, what matters is that it keeps coming.
 */
const JSON_TIMEOUT_MS = 60_000;
const FIRST_BYTE_TIMEOUT_MS = 30_000;
const STALL_TIMEOUT_MS = 30_000;

const TIMED_OUT = "応答に時間がかかりすぎています。もう一度お試しください。";

/** The ID token itself is a network call when the cached one has expired. */
function idToken(user: User): Promise<string> {
  return withTimeout(user.getIdToken(), LOAD_TIMEOUT_MS, TIMED_OUT);
}

function toApiError(status: number, payload: ErrorPayload): ApiError {
  return new ApiError(
    status,
    payload?.error ?? FALLBACK_ERROR,
    payload?.retryable !== false,
  );
}

export async function postJson<T>(path: string, user: User, body: unknown): Promise<T> {
  const token = await idToken(user);

  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
  }).catch((e: unknown) => {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new ApiError(504, TIMED_OUT);
    }
    throw e;
  });

  const payload = (await res.json().catch(() => null)) as ErrorPayload;

  if (!res.ok) throw toApiError(res.status, payload);

  return payload as T;
}

/**
 * Same contract as postJson, but for a route that streams plain text back.
 *
 * `onChunk` receives each decoded delta as it lands so the reply can be shown
 * while it is still being written; the resolved value is the whole reply, which
 * is what gets saved to Firestore once the turn is finished.
 */
export async function postStream(
  path: string,
  user: User,
  body: unknown,
  onChunk: (delta: string) => void,
): Promise<string> {
  const token = await idToken(user);

  // A stream cannot have one deadline over the whole thing — a long reply is
  // not a broken one. What can be bounded is silence: how long before the
  // first byte, and how long between two of them. Every chunk that lands
  // renews the budget, so the timer only ever fires on a reply that stopped.
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), FIRST_BYTE_TIMEOUT_MS);
  const renew = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
  };

  try {
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      // Failures are still sent as JSON, because the status is decided before
      // the first chunk of a successful reply is written.
      throw toApiError(res.status, (await res.json().catch(() => null)) as ErrorPayload);
    }

    const reader = res.body.getReader();
    // Multi-byte Japanese characters get split across chunk boundaries, so the
    // decoder has to carry state between reads rather than decode each one alone.
    const decoder = new TextDecoder();
    let full = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      renew();
      const delta = decoder.decode(value, { stream: true });
      if (delta) {
        full += delta;
        onChunk(delta);
      }
    }

    const tail = decoder.decode();
    if (tail) {
      full += tail;
      onChunk(tail);
    }

    if (!full.trim()) {
      throw new ApiError(502, "返答を受け取れませんでした。もう一度お試しください。");
    }

    return full;
  } catch (e) {
    // Whatever the abort surfaced as — an AbortError from fetch, a read that
    // threw partway — the student's side of it is the same sentence.
    if (controller.signal.aborted) throw new ApiError(504, TIMED_OUT);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
