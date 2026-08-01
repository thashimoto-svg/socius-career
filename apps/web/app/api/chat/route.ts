import type { MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
import {
  buildChatSystemPrompt,
  buildOpeningInstruction,
  type PromptProfile,
  type ToneId,
} from "@socius/prompts";
import { isRateLimited, verifyRequest } from "@/lib/server/auth";
import {
  callAnthropic,
  CHAT_MAX_TOKENS,
  CHAT_MODEL,
  getAnthropic,
  isAiFailure,
  toAnthropicMessages,
} from "@/lib/server/anthropic";
import { historyWindow, parseMessages } from "@/lib/server/transcript";
import {
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

  /**
   * Start the turn and pull its first piece of text.
   *
   * The first chunk is taken before any response is returned, because once a
   * streaming body is handed back the status code is already on the wire and a
   * failure can only be shown as a truncated reply. Rate limits, overload and
   * auth errors all surface on this first pull, so the common failures still
   * get a real status and a Japanese message the student can act on.
   */
  async function openStream() {
    const started = getAnthropic().messages.stream({
      model: CHAT_MODEL,
      max_tokens: CHAT_MAX_TOKENS,
      system: buildChatSystemPrompt({ profile, mode, theme }),
      messages: opening
        ? [{ role: "user", content: buildOpeningInstruction() }]
        : // Only the tail of the conversation is sent. Firestore keeps all of
          // it; what the model needs is the part it is answering.
          toAnthropicMessages(historyWindow(messages)),
    });

    // Driven with next() rather than `for await`, because breaking out of a
    // for-await loop closes the iterator — the rest of the reply would be
    // thrown away the moment the first chunk arrived.
    const iterator = started[Symbol.asyncIterator]();

    let head = "";
    try {
      for (;;) {
        const { value, done } = await iterator.next();
        if (done) break;
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

    return { stream: started, iterator, head };
  }

  try {
    const result = await callAnthropic("api/chat", openStream);
    stream = result.stream;
    events = result.iterator;
    first = result.head;

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
          const text = deltaText(value);
          if (text) controller.enqueue(encoder.encode(text));
        }
      } catch (e) {
        // Nothing can be said in-band at this point; the client keeps the
        // partial reply rather than losing the turn.
        console.error("[api/chat] stream interrupted", e);
      } finally {
        controller.close();
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
