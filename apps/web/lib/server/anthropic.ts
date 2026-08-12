import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
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
export function toAnthropicMessages(
  messages: WireMessage[],
  /**
   * Mark the end of the transcript as a cache breakpoint.
   *
   * Only meaningful while the conversation still fits in the history window —
   * see HistoryWindow.complete in ./transcript. Off by default so that a caller
   * who has not thought about it does not pay a write premium by accident.
   */
  cacheTail = false,
): MessageParam[] {
  const converted: MessageParam[] = messages.map((m) => ({
    role: m.role === "ai" ? ("assistant" as const) : ("user" as const),
    content: m.text,
  }));

  if (converted.length > 0 && converted[0].role === "assistant") {
    converted.unshift({ role: "user", content: "（壁打ちを始めます）" });
  }

  // The last turn, not the last-but-one. This request will not read what it
  // writes — the entry is for the *next* turn, whose transcript begins with
  // everything in this one.
  if (cacheTail && converted.length > 0) {
    const last = converted[converted.length - 1];
    converted[converted.length - 1] = {
      role: last.role,
      content: [
        {
          type: "text",
          text: typeof last.content === "string" ? last.content : "",
          cache_control: { type: "ephemeral" },
        },
      ],
    };
  }

  return converted;
}

// ---------------------------------------------------------------------------
// What a turn cost
// ---------------------------------------------------------------------------

/**
 * The four numbers a Claude bill is made of.
 *
 * Split rather than summed because they are priced differently — a cache read
 * is a tenth of an input token and a cache write is one and a quarter — so a
 * single "input" figure could not be turned back into money. Keeping them apart
 * is also the only way to see whether the cache is working at all: `cacheRead`
 * staying at zero across a conversation is the signature of a silently broken
 * breakpoint, and it looks like nothing at all in a total.
 */
export type TokenUsage = {
  /** Uncached input. */
  input: number;
  output: number;
  /** Written to the cache this turn, billed at ~1.25×. */
  cacheWrite: number;
  /** Served from the cache this turn, billed at ~0.1×. */
  cacheRead: number;
};

export const NO_TOKENS: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

export function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

export function hasTokens(u: TokenUsage): boolean {
  return u.input > 0 || u.output > 0 || u.cacheWrite > 0 || u.cacheRead > 0;
}

/** The shape both a non-streaming message and a stream event report usage in. */
type RawUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

const n = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

export function toTokenUsage(raw: RawUsage | null | undefined): TokenUsage {
  if (!raw) return NO_TOKENS;
  return {
    input: n(raw.input_tokens),
    output: n(raw.output_tokens),
    cacheWrite: n(raw.cache_creation_input_tokens),
    cacheRead: n(raw.cache_read_input_tokens),
  };
}

/**
 * Fold one stream event into the running total for a streamed turn.
 *
 * A stream reports its cost in two places and it is not a sum of them.
 * `message_start` carries the whole input side — uncached input, cache write,
 * cache read — plus an output count that is only the tokens emitted so far.
 * `message_delta` then carries the *cumulative* output as it grows. So the
 * input fields are taken once and the output field is overwritten rather than
 * added, which is why this is a fold with two different rules rather than a
 * running sum.
 *
 * Reading the events rather than awaiting `finalMessage()` is deliberate: this
 * route aborts its stream when the student navigates away, and a turn that was
 * abandoned halfway still cost whatever it had generated by then. Those tokens
 * are billed, so they are recorded.
 */
export function foldStreamUsage(total: TokenUsage, event: MessageStreamEvent): TokenUsage {
  if (event.type === "message_start") {
    const started = toTokenUsage(event.message.usage as RawUsage);
    return { ...started, output: Math.max(total.output, started.output) };
  }

  if (event.type === "message_delta") {
    const delta = toTokenUsage(event.usage as RawUsage);
    return {
      // `message_delta` re-reports the input side on some models and omits it
      // on others; whichever arrived first is the one that is true.
      input: Math.max(total.input, delta.input),
      cacheWrite: Math.max(total.cacheWrite, delta.cacheWrite),
      cacheRead: Math.max(total.cacheRead, delta.cacheRead),
      output: Math.max(total.output, delta.output),
    };
  }

  return total;
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
