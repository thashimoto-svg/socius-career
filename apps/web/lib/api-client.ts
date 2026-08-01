import type { User } from "firebase/auth";

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

function toApiError(status: number, payload: ErrorPayload): ApiError {
  return new ApiError(
    status,
    payload?.error ?? FALLBACK_ERROR,
    payload?.retryable !== false,
  );
}

export async function postJson<T>(path: string, user: User, body: unknown): Promise<T> {
  const token = await user.getIdToken();

  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
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
  const token = await user.getIdToken();

  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
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
}
