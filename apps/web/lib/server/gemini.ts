import { GoogleGenAI } from "@google/genai";
import {
  historyWindow,
  HISTORY_RALLIES,
  parseMessages,
  type WireMessage,
} from "./transcript";

/**
 * Server-only Gemini client — the rollback path, no longer wired to any route.
 *
 * The 壁打ち runs on Claude (lib/server/anthropic.ts) since the Gemini free
 * tier's per-day cap started being hit in normal use. This file is kept intact
 * so switching back is an import change rather than a rewrite; the offline
 * checks in scripts/check-gemini-guards.mjs still exercise it.
 *
 * GEMINI_API_KEY has no NEXT_PUBLIC_ prefix on purpose: it must never reach the
 * browser, so every call goes through a route handler.
 */

// The transcript handling is provider-neutral and now lives on its own. Kept
// re-exported here so this file reads — and can be re-adopted — as one piece.
export { historyWindow, HISTORY_RALLIES, parseMessages };
export type { WireMessage };

let client: GoogleGenAI | undefined;

export function getGemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to apps/web/.env.local and restart the dev server.",
    );
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

/**
 * 2.5 Flash for both paths: the 壁打ち is a turn-by-turn conversation where a
 * slow reply reads as the app being broken, and the extraction is a
 * restructuring job rather than a reasoning one.
 */
export const CHAT_MODEL = "gemini-2.5-flash";
export const EXTRACT_MODEL = "gemini-2.5-flash";

/** Gemini calls the assistant side "model"; the app calls it "ai". */
export function toGeminiContents(messages: WireMessage[]) {
  return messages.map((m) => ({
    role: m.role === "ai" ? "model" : "user",
    parts: [{ text: m.text }],
  }));
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

export type GeminiFailureKind =
  | "daily-quota"
  | "rate-limit"
  | "overloaded"
  | "config"
  | "unknown";

export type GeminiFailure = {
  kind: GeminiFailureKind;
  /** Status to answer the browser with. */
  status: number;
  /** What the student reads. Must be true of the actual failure. */
  message: string;
  /** Seconds the API asked us to wait, when it said. */
  retryAfterSeconds: number | null;
};

function statusOf(error: unknown): number | null {
  const e = error as { status?: unknown; message?: unknown } | null;
  if (typeof e?.status === "number") return e.status;
  // The SDK nests the upstream body inside its own message, so the code is
  // sometimes only reachable as text.
  const code = /"code":\s*(\d{3})/.exec(String(e?.message ?? ""));
  return code ? Number(code[1]) : null;
}

function retryDelayOf(error: unknown): number | null {
  // The upstream body is a JSON string inside the SDK's own JSON, so every
  // quote around `retryDelay` arrives backslash-escaped. Dropping the escapes
  // first is steadier than trying to spell them out in the pattern.
  const text = String((error as { message?: unknown })?.message ?? "").replace(/\\/g, "");
  const m =
    /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s/.exec(text) ??
    /retry in (\d+(?:\.\d+)?)s/.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Work out what actually went wrong, so the student is told something true.
 *
 * The distinction that matters is between the per-minute and per-day quota.
 * Both arrive as 429 RESOURCE_EXHAUSTED and are indistinguishable unless the
 * quotaId is read: one clears in under a minute, the other not until the date
 * changes. Telling a student to wait a moment when the answer is "not today"
 * is how 「AIの応答に失敗しました」 became a dead end nobody could get out of.
 */
export function classifyGeminiFailure(error: unknown): GeminiFailure {
  const status = statusOf(error);
  const text = String((error as { message?: unknown })?.message ?? "");
  const retryAfterSeconds = retryDelayOf(error);

  if (status === 429) {
    if (/PerDayPerProject|RequestsPerDay/i.test(text)) {
      return {
        kind: "daily-quota",
        status: 429,
        message:
          "本日ぶんのAI利用上限に達しました。日付が変わると再開できます。話した内容は残っているので、続きは明日から書けます。",
        retryAfterSeconds,
      };
    }
    return {
      kind: "rate-limit",
      status: 429,
      message: "いま混み合っています。少し待ってから送信してください。",
      retryAfterSeconds,
    };
  }

  if (status !== null && status >= 500) {
    return {
      kind: "overloaded",
      status: 503,
      message: "AIが混み合っています。もう一度送信してください。",
      retryAfterSeconds,
    };
  }

  // A rejected key or a disabled API is ours to fix, not something the student
  // can wait out, so it must not be dressed up as a temporary hiccup.
  if (status === 401 || status === 403 || /GEMINI_API_KEY/.test(text)) {
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
 * deadline. When the API says to come back in 35 seconds — which is what the
 * per-minute quota actually says — there is nothing to gain by holding the
 * request open: the honest move is to answer quickly and let them resend.
 */
const BACKOFF_BUDGET_MS = 4_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a Gemini call, retrying the failures that retrying can fix.
 *
 * Overload (5xx) and the per-minute quota are worth another attempt. The daily
 * quota and a bad key are not: the same request will fail the same way, and two
 * pointless retries only add seconds to an error the student is going to see
 * anyway.
 *
 * Throws the classified failure rather than the SDK error, so both routes
 * answer with the same vocabulary.
 */
export async function callGemini<T>(label: string, call: () => Promise<T>): Promise<T> {
  let spent = 0;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const failure = classifyGeminiFailure(error);
      const worthRetrying = failure.kind === "overloaded" || failure.kind === "rate-limit";

      const backoff = BASE_BACKOFF_MS * 2 ** attempt;
      const wait = Math.max(backoff, (failure.retryAfterSeconds ?? 0) * 1000);
      const affordable = spent + wait <= BACKOFF_BUDGET_MS;

      if (attempt >= MAX_RETRIES || !worthRetrying || !affordable) {
        console.error(
          `[${label}] Gemini call failed (${failure.kind}, attempt ${attempt + 1})`,
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
export function isGeminiFailure(value: unknown): value is GeminiFailure {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as GeminiFailure).kind === "string" &&
    typeof (value as GeminiFailure).message === "string" &&
    typeof (value as GeminiFailure).status === "number"
  );
}
