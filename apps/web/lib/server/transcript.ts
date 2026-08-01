/**
 * The transcript, as the route handlers see it.
 *
 * Nothing here knows which model the conversation is going to. It was split out
 * of lib/server/gemini.ts when the 壁打ち moved to Claude: the sliding window and
 * the input sanitising are properties of *this app's* conversation, not of a
 * vendor SDK, and both providers need them. gemini.ts re-exports these so the
 * rollback path and its offline checks keep working unchanged.
 */

/** One transcript line, in the shape both route handlers accept. */
export type WireMessage = { role: "user" | "ai"; text: string };

const MAX_TEXT = 8000;
const MAX_MESSAGES = 40;

/**
 * Coerce whatever the client posted into a transcript, dropping anything
 * malformed. The browser is not a trusted source even when the student is.
 */
export function parseMessages(value: unknown): WireMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (m): m is WireMessage =>
        !!m &&
        typeof m === "object" &&
        (m as WireMessage).role !== undefined &&
        typeof (m as WireMessage).text === "string",
    )
    .map((m) => ({
      role: m.role === "ai" ? ("ai" as const) : ("user" as const),
      text: m.text.slice(0, MAX_TEXT),
    }))
    .filter((m) => m.text.trim().length > 0)
    .slice(-MAX_MESSAGES);
}

/**
 * How many 往復 of history the 壁打ち sends.
 *
 * A rally costs roughly 160 input tokens at real message lengths, and the
 * system prompt about 500. Twelve rallies is around 2,400 tokens per request —
 * far under any limit, and well past the three rungs of the depth ladder
 * (事実 → なぜ → 価値観) that a reply actually reasons over. The theme lives in
 * the system prompt, so dropping the oldest turns does not lose what the
 * conversation is about.
 *
 * Firestore keeps every turn regardless; this bounds only the request.
 */
export const HISTORY_RALLIES = 12;

/**
 * A second bound, on characters rather than turns.
 *
 * MAX_TEXT allows 8,000 characters per message, so twelve rallies could in
 * principle be 190,000 characters. Japanese runs about two characters per
 * token here, making this budget roughly 12,000 tokens.
 */
const HISTORY_CHAR_BUDGET = 24_000;

/**
 * The tail of the transcript, as a sliding window.
 *
 * Trimmed from the oldest end: the newest turn is the one being answered, so it
 * is the last thing that may be dropped. A single turn longer than the whole
 * budget is still sent — refusing to answer it would be worse than a large
 * request.
 */
export function historyWindow(
  messages: WireMessage[],
  rallies: number = HISTORY_RALLIES,
): WireMessage[] {
  const recent = messages.slice(-rallies * 2);

  let chars = 0;
  let start = recent.length;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    chars += recent[i].text.length;
    if (chars > HISTORY_CHAR_BUDGET && i < recent.length - 1) break;
    start = i;
  }

  return recent.slice(start);
}
