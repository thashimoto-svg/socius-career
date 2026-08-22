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
 * Twelve, then six for the β budget, and sixteen now.
 *
 * The measured numbers behind the cut to six still hold: a rally is about 83
 * tokens against a system prompt of 1,403, so history was never the dominant
 * cost. What changed is what six turns did to the conversation. 「同じことを
 * 二度聞かれる」 (β報告 8/18) is what a window looks like from the inside — at
 * the seventh rally the fact the model is asking about has fallen off the
 * front of its own request, so it asks again, and the student answers a
 * question they have already answered.
 *
 * Sixteen is two hours of talking rather than twenty minutes, and it is
 * affordable because of what sits in front of it: the system prompt is cached,
 * and so is every turn of the transcript up to the newest one (see
 * HistoryWindow.complete). Turns past the sixteenth are read at a tenth of
 * list price, not written out again at full.
 *
 * It is still a window, and a window still forgets. What stops the sixteenth
 * rally from losing the first one is not this number but the エピソードシート,
 * which is rewritten every turn and travels with the request whatever the
 * window is holding.
 *
 * Firestore keeps every turn regardless; this bounds only the request.
 */
export const HISTORY_RALLIES = 16;

/**
 * A second bound, on characters rather than turns.
 *
 * MAX_TEXT allows 8,000 characters per message, so sixteen rallies could in
 * principle be 256,000 characters. Japanese runs about two characters per
 * token here, making this budget roughly 12,000 tokens.
 *
 * Left where it was when the window went from six rallies to sixteen. A real
 * 壁打ち turn is a sentence or two — the scripted transcripts in scripts/ run
 * about 350 characters a rally, so sixteen of them is around 5,600 and this
 * cap is nowhere near it. What it is actually for is the student who pastes an
 * ES draft into the box: three of those in a row is the shape that would
 * otherwise send 24,000 characters of history behind them.
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
  return windowOf(messages, rallies).messages;
}

export type HistoryWindow = {
  /** The turns actually sent. */
  messages: WireMessage[];
  /**
   * True when nothing was dropped — the window still holds the whole
   * conversation.
   *
   * This exists for the prompt cache, and it is the one place where the sliding
   * window and caching pull against each other. A cache entry is a prefix
   * match, so it survives only while the *front* of the request stays put. That
   * is true of a growing conversation: each turn appends, and every earlier turn
   * is still there, byte for byte, so the next request reads what the last one
   * wrote. The moment the window starts sliding it stops being true — the oldest
   * rally falls off the front, every following byte shifts, and the entry the
   * previous turn wrote can never be read by anyone.
   *
   * A breakpoint there would not merely miss. It would cost: a write is charged
   * at 1.25×, so marking a prefix that is guaranteed stale buys a 25% surcharge
   * on the history of every turn past the sixth, forever. So the caller places
   * the message-level breakpoint only while this is true, and drops it after.
   */
  complete: boolean;
};

function windowOf(messages: WireMessage[], rallies: number): HistoryWindow {
  const recent = messages.slice(-rallies * 2);

  let chars = 0;
  let start = recent.length;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    chars += recent[i].text.length;
    if (chars > HISTORY_CHAR_BUDGET && i < recent.length - 1) break;
    start = i;
  }

  const kept = recent.slice(start);
  return { messages: kept, complete: kept.length === messages.length };
}

/** The window, plus whether it is still the whole conversation. */
export function historyWindowWithState(
  messages: WireMessage[],
  rallies: number = HISTORY_RALLIES,
): HistoryWindow {
  return windowOf(messages, rallies);
}
