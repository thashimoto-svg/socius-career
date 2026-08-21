import type { MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages";
import {
  buildChatSystemBlocks,
  buildOpeningInstruction,
  mergeWorksheet,
  parseWorksheet,
  toWorksheet,
  worksheetPrompt,
  type PromptProfile,
  type ToneId,
} from "@socius/prompts";
import { isRateLimited, verifyRequest } from "@/lib/server/auth";
import {
  callAnthropic,
  CHAT_MAX_TOKENS,
  CHAT_MODEL,
  foldStreamUsage,
  getAnthropic,
  isAiFailure,
  NO_TOKENS,
  toAnthropicMessages,
  type TokenUsage,
} from "@/lib/server/anthropic";
import { historyWindowWithState, parseMessages } from "@/lib/server/transcript";
import { isSessionId, saveWorksheet } from "@/lib/server/worksheet";
import {
  addTokenUsage,
  checkDailyLimit,
  DAILY_LIMIT_MESSAGE,
  usageDay,
  writeUsage,
} from "@/lib/server/usage";

/**
 * One turn of the 壁打ち.
 *
 * The profile arrives in the request body rather than being read from
 * Firestore: verifying the ID token already proves who the caller is, and the
 * only data they could misreport is their own survey answers, which changes
 * nothing except the questions they get asked. That keeps this route free of
 * server-side Firestore credentials.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  mode?: string;
  theme?: string;
  profile?: PromptProfile | null;
  messages?: unknown;
  /** Which 壁打ち this turn belongs to — where the sheet is written back. */
  sessionId?: unknown;
  /** The sheet as the client holds it, including anything the student edited. */
  worksheet?: unknown;
};

function parseProfile(value: unknown): PromptProfile | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<PromptProfile>;
  if (typeof p.grade !== "string" || typeof p.club !== "string") return null;
  return {
    grade: p.grade.slice(0, 40),
    club: p.club.slice(0, 40),
    industries: Array.isArray(p.industries)
      ? p.industries.filter((i): i is string => typeof i === "string").slice(0, 10)
      : [],
  };
}

/** The text carried by one stream event, or "" for the events that carry none. */
function deltaText(event: MessageStreamEvent): string {
  return event.type === "content_block_delta" && event.delta.type === "text_delta"
    ? event.delta.text
    : "";
}

export async function POST(request: Request) {
  const caller = await verifyRequest(request);
  if (!caller) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { uid, idToken } = caller;

  if (isRateLimited(uid)) {
    return Response.json(
      { error: "少し早すぎるようです。数秒おいてからもう一度お試しください。" },
      { status: 429 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const mode: ToneId = body.mode === "karakuchi" ? "karakuchi" : "counselor";
  const profile = parseProfile(body.profile);
  const messages = parseMessages(body.messages);
  const theme = typeof body.theme === "string" ? body.theme.slice(0, 120) : "";

  /**
   * The sheet, as it stands before this turn.
   *
   * Read from the request rather than from Firestore, for the same reason the
   * profile is: verifying the ID token already proves who the caller is, and
   * the only thing they could misreport is their own conversation's notes,
   * which changes nothing except the questions they get asked. Reading it here
   * would be a Firestore round trip in front of every reply, on the screen
   * where latency is most visible.
   */
  const sheet = toWorksheet(body.worksheet);
  const sessionId = isSessionId(body.sessionId) ? body.sessionId : null;

  // An empty transcript means the session is brand new and the AI speaks
  // first; there is no student turn to respond to yet.
  const opening = messages.length === 0;

  // The opening line is not charged. It is the app talking, and a student who
  // opened three threads and typed in none of them has not used anything.
  const day = usageDay();
  const usage = opening
    ? { allowed: true, next: 0 }
    : await checkDailyLimit(uid, idToken, day);

  if (!usage.allowed) {
    return Response.json(
      // Not retryable, so the client shows this instead of a 再送 button that
      // would fail the same way until the date changes.
      { error: DAILY_LIMIT_MESSAGE, retryable: false },
      { status: 429 },
    );
  }

  let stream: Awaited<ReturnType<typeof openStream>>["stream"];
  let events: AsyncIterator<MessageStreamEvent>;
  let first: string;
  let tokens: TokenUsage;

  /**
   * Start the turn and pull its first piece of text.
   *
   * The first chunk is taken before any response is returned, because once a
   * streaming body is handed back the status code is already on the wire and a
   * failure can only be shown as a truncated reply. Rate limits, overload and
   * auth errors all surface on this first pull, so the common failures still
   * get a real status and a Japanese message the student can act on.
   */
  // Only the tail of the conversation is sent. Firestore keeps all of it; what
  // the model needs is the part it is answering.
  const history = historyWindowWithState(messages);

  async function openStream() {
    const started = getAnthropic().messages.stream({
      model: CHAT_MODEL,
      max_tokens: CHAT_MAX_TOKENS,
      // Two blocks, two cache breakpoints — the shared 深掘り層+トーン層 and
      // then this student's オンボーディング注入部. The cast is the same seam the
      // tool schemas use: prompts/ stays free of SDK imports so the offline
      // guards and the Gemini rollback can read it.
      system: buildChatSystemBlocks({ profile, mode, theme }) as TextBlockParam[],
      messages: opening
        ? [{ role: "user", content: buildOpeningInstruction() }]
        : // A third breakpoint on the transcript, but only while the window
          // still holds the whole conversation. Once it starts sliding the
          // oldest rally falls off the front of every request and the entry
          // could never be read — marking it then would buy nothing and be
          // charged 1.25× for it.
          // The sheet rides at the end, behind the breakpoint: it is what
          // keeps the turns that have fallen out of the window from being
          // forgotten, and it is different every turn, so it must not sit in
          // front of anything cached.
          toAnthropicMessages(history.messages, history.complete, worksheetPrompt(sheet)),
    });

    // Driven with next() rather than `for await`, because breaking out of a
    // for-await loop closes the iterator — the rest of the reply would be
    // thrown away the moment the first chunk arrived.
    const iterator = started[Symbol.asyncIterator]();

    let head = "";
    // `message_start` carries the whole input side of the bill — including
    // whether the cache was read — and it arrives before the first text, so it
    // is folded in here rather than left to the loop below. Accumulated per
    // attempt: a retried turn starts a new stream with its own usage.
    let tokens = NO_TOKENS;
    try {
      for (;;) {
        const { value, done } = await iterator.next();
        if (done) break;
        tokens = foldStreamUsage(tokens, value);
        const text = deltaText(value);
        if (text) {
          head = text;
          break;
        }
      }
    } catch (e) {
      started.abort();
      throw e;
    }

    // A retry has to start from a fresh stream, so a spent one is closed
    // rather than left for the next attempt to read from.
    if (!head) {
      started.abort();
      throw new Error("empty first chunk");
    }

    return { stream: started, iterator, head, tokens };
  }

  try {
    const result = await callAnthropic("api/chat", openStream);
    stream = result.stream;
    events = result.iterator;
    first = result.head;
    tokens = result.tokens;

    // Charged once the model has actually started answering, so a turn that
    // failed on quota or a bad key does not come out of the student's day.
    // Not awaited — the reply is already coming, and the counter must not put
    // a Firestore round trip in front of it.
    if (usage.next > 0) {
      void writeUsage(uid, idToken, day, usage.next).catch((e) =>
        console.error("[usage] could not record the turn", e),
      );
    }
  } catch (e) {
    if (isAiFailure(e)) {
      return Response.json(
        { error: e.message },
        {
          status: e.status,
          headers: e.retryAfterSeconds
            ? { "retry-after": String(Math.ceil(e.retryAfterSeconds)) }
            : undefined,
        },
      );
    }
    console.error("[api/chat] unexpected failure", e);
    return Response.json(
      { error: "返答を受け取れませんでした。もう一度送信してください。" },
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  const responseBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(first));
      // The reply is also kept whole, not only forwarded a chunk at a time:
      // the エピソードシート is written at the very end of it, and it is this
      // side that saves it. The client is sent the same bytes and strips the
      // block before anything is drawn or stored.
      let full = first;
      try {
        for (;;) {
          // A student who navigates away mid-reply should not keep the
          // generation running against their quota.
          if (request.signal.aborted) {
            stream.abort();
            break;
          }
          const { value, done } = await events.next();
          if (done) break;
          tokens = foldStreamUsage(tokens, value);
          const text = deltaText(value);
          if (text) {
            full += text;
            controller.enqueue(encoder.encode(text));
          }
        }
      } catch (e) {
        // Nothing can be said in-band at this point; the client keeps the
        // partial reply rather than losing the turn.
        console.error("[api/chat] stream interrupted", e);
      } finally {
        controller.close();

        /**
         * What the turn actually cost, recorded once it is over.
         *
         * It has to be here and not beside the message counter above: the
         * output count is only final when the stream is, and the cache figures
         * are what make the difference between a cheap turn and an expensive
         * one legible. This runs on every exit from the loop, including the
         * abort when a student navigates away mid-reply — those tokens were
         * generated and billed, so leaving them unrecorded would make the
         * total quietly optimistic.
         *
         * Never awaited by the response: the body is already closed and the
         * student has their reply. A failure here loses one turn of accounting
         * and nothing else, which is why it is logged rather than raised.
         */
        void addTokenUsage(uid, idToken, day, tokens).catch((e) =>
          console.error("[usage] could not record the turn's tokens", e),
        );

        /**
         * この回の整理を、会話の記憶として書き戻す。
         *
         * 打ち切られた回にはシートのブロックが届いていないので、mergeWorksheet は
         * 「変わっていない」を返し、書き込みは起きない。それでよく、それが正しい:
         * 途中で止めた返答の途中までの整理を保存すると、次のターンには本人が読んで
         * いない結論が「聞いた話」として同封される。
         *
         * 応答の外で走る。本文はもう閉じていて、学生は返事を読んでいる。ここで失敗
         * して失われるのは1ターンぶんの整理で、会話そのものではない——だから投げず
         * に記録する。
         */
        const update = parseWorksheet(full);
        if (sessionId && update) {
          void saveWorksheet(uid, idToken, sessionId, mergeWorksheet(sheet, update)).catch(
            (e) => console.error("[worksheet] シートを保存できませんでした", e),
          );
        }
      }
    },
  });

  return new Response(responseBody, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      // Proxies that buffer would defeat the point of streaming at all.
      "x-accel-buffering": "no",
    },
  });
}
