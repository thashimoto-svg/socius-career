import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { WireMessage } from "./transcript";

/**
 * Server-only Claude client.
 *
 * ANTHROPIC_API_KEY has no NEXT_PUBLIC_ prefix on purpose: it must never reach
 * the browser, so every call goes through a route handler.
 *
 * Replaced Gemini after the free tier's per-day cap was hit in real use and
 * 「AIの応答に失敗しました」 started being the normal outcome rather than the rare
 * one. lib/server/gemini.ts is kept, unused, as the way back.
 */

let client: Anthropic | undefined;

export function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to apps/web/.env.local and restart the dev server.",
    );
  }
  // maxRetries: 0 because callAnthropic() below owns the retry policy. Left at
  // the SDK default the two would compound, and a student would sit in front of
  // a spinner for the product of both.
  client ??= new Anthropic({ apiKey, maxRetries: 0 });
  return client;
}

/**
 * Which model answers. Swappable without a deploy of new code so the 壁打ち can
 * be moved up or down a tier from configuration alone.
 *
 * Nothing below sends `temperature` or `thinking`. Both are model-specific in a
 * way that would make CHAT_MODEL a lie: `temperature` is rejected outright by
 * Opus 4.7 and later, and whether omitting `thinking` means "off" or "adaptive"
 * differs by model. Leaving both unset is the only setting that is valid on
 * every model someone might put in this variable.
 */
export const CHAT_MODEL = process.env.CHAT_MODEL || "claude-sonnet-4-6";
export const EXTRACT_MODEL = process.env.EXTRACT_MODEL || CHAT_MODEL;

/**
 * Output ceiling for one 壁打ち turn.
 *
 * A reply is specified at 120–200 Japanese characters, so this is generous. It
 * is not tight on purpose: on a model that thinks by default, max_tokens caps
 * thinking *and* the reply together, and a tight ceiling would truncate the
 * answer rather than the deliberation.
 */
export const CHAT_MAX_TOKENS = 2048;

/** Enough for a fully populated STAR card with every slot written out. */
export const EXTRACT_MAX_TOKENS = 4096;

/**
 * The transcript, in Anthropic's vocabulary.
 *
 * Two shape rules have to be satisfied that the app's own transcript does not
 * naturally meet: the first message must be `user`, and our conversations
 * always open with the AI's question. Rather than dropping that question — it
 * is what the student's first answer is a reply to, so losing it would make the
 * first turn incoherent — a short user turn is put in front of it.
 */
export function toAnthropicMessages(messages: WireMessage[]): MessageParam[] {
  const converted: MessageParam[] = messages.map((m) => ({
    role: m.role === "ai" ? ("assistant" as const) : ("user" as const),
    content: m.text,
  }));

  if (converted.length > 0 && converted[0].role === "assistant") {
    converted.unshift({ role: "user", content: "（壁打ちを始めます）" });
  }

  return converted;
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

export type AiFailureKind = "rate-limit" | "overloaded" | "config" | "unknown";

export type AiFailure = {
  kind: AiFailureKind;
  /** Status to answer the browser with. */
  status: number;
  /** What the student reads. Must be true of the actual failure. */
  message: string;
  /** Seconds the API asked us to wait, when it said. */
  retryAfterSeconds: number | null;
};

/** 「少し待って再送してください」 — the one message both busy states get. */
const BUSY_MESSAGE = "混み合っています。少し待って再送してください。";

function statusOf(error: unknown): number | null {
  const e = error as { status?: unknown } | null;
  return typeof e?.status === "number" ? e.status : null;
}

/**
 * `retry-after`, when the API sent one.
 *
 * The SDK's `headers` is a Headers object on a real response and absent on a
 * connection error, so both shapes are probed rather than assumed.
 */
function retryAfterOf(error: unknown): number | null {
  const headers = (error as { headers?: unknown } | null)?.headers;
  const raw =
    headers instanceof Headers
      ? headers.get("retry-after")
      : typeof (headers as Record<string, string> | undefined)?.["retry-after"] === "string"
        ? (headers as Record<string, string>)["retry-after"]
        : null;

  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * Work out what actually went wrong, so the student is told something true.
 *
 * The distinction that has to survive is between "wait and it clears" and "an
 * operator has to fix this". A rejected key dressed up as a temporary hiccup is
 * how 「AIの応答に失敗しました」 became a dead end nobody could get out of.
 */
export function classifyAnthropicFailure(error: unknown): AiFailure {
  const status = statusOf(error);
  const text = String((error as { message?: unknown })?.message ?? "");
  const retryAfterSeconds = retryAfterOf(error);

  // A missing key throws before any request is made, so it has no status.
  if (/ANTHROPIC_API_KEY/.test(text)) {
    return {
      kind: "config",
      status: 500,
      message:
        "サーバー側の設定に問題があります。おそれいりますが運営に連絡してください。",
      retryAfterSeconds: null,
    };
  }

  if (status === 429) {
    return { kind: "rate-limit", status: 429, message: BUSY_MESSAGE, retryAfterSeconds };
  }

  // 529 is Anthropic's "overloaded"; any other 5xx is theirs to fix and ours to
  // retry. Both read the same to a student: come back in a moment.
  if (status !== null && status >= 500) {
    return { kind: "overloaded", status: 503, message: BUSY_MESSAGE, retryAfterSeconds };
  }

  if (status === 401 || status === 403) {
    return {
      kind: "config",
      status: 500,
      message:
        "サーバー側の設定に問題があります。おそれいりますが運営に連絡してください。",
      retryAfterSeconds: null,
    };
  }

  return {
    kind: "unknown",
    status: 502,
    message: "AIの応答に失敗しました。もう一度送信してください。",
    retryAfterSeconds,
  };
}

/** Retries, and the waits between them. Two retries, exponential, jittered. */
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 800;
/**
 * A student is watching a spinner while this runs, so the retries have a
 * deadline. When a 429 says to come back in sixty seconds there is nothing to
 * gain by holding the request open: the honest move is to answer quickly and
 * let them press 再送.
 */
const BACKOFF_BUDGET_MS = 4_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a Claude call, retrying the failures that retrying can fix.
 *
 * 429 and 529 are worth another attempt. A bad key is not: the same request
 * fails the same way, and two pointless retries only add seconds to an error
 * the student is going to see anyway.
 *
 * Throws the classified failure rather than the SDK error, so both routes
 * answer with the same vocabulary.
 */
export async function callAnthropic<T>(label: string, call: () => Promise<T>): Promise<T> {
  let spent = 0;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const failure = classifyAnthropicFailure(error);
      const worthRetrying = failure.kind === "overloaded" || failure.kind === "rate-limit";

      const backoff = BASE_BACKOFF_MS * 2 ** attempt;
      const wait = Math.max(backoff, (failure.retryAfterSeconds ?? 0) * 1000);
      const affordable = spent + wait <= BACKOFF_BUDGET_MS;

      if (attempt >= MAX_RETRIES || !worthRetrying || !affordable) {
        console.error(
          `[${label}] Claude call failed (${failure.kind}, attempt ${attempt + 1})`,
          error,
        );
        throw failure;
      }

      const jittered = wait + Math.random() * 250;
      console.warn(
        `[${label}] ${failure.kind}, retrying in ${Math.round(jittered)}ms ` +
          `(attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
      );
      spent += jittered;
      await sleep(jittered);
    }
  }
}

/** Type guard so a route can tell a classified failure from a real crash. */
export function isAiFailure(value: unknown): value is AiFailure {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as AiFailure).kind === "string" &&
    typeof (value as AiFailure).message === "string" &&
    typeof (value as AiFailure).status === "number"
  );
}
