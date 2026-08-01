import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import {
  buildExtractionPrompt,
  EPISODE_TAGS,
  EPISODE_TOOL_INPUT_SCHEMA,
  EPISODE_TOOL_NAME,
  EXTRACTION_SYSTEM_PROMPT,
  type ExtractedEpisode,
} from "@socius/prompts";
import { isRateLimited, verifyRequestUid } from "@/lib/server/auth";
import {
  callAnthropic,
  EXTRACT_MAX_TOKENS,
  EXTRACT_MODEL,
  getAnthropic,
  isAiFailure,
} from "@/lib/server/anthropic";
import { historyWindow, parseMessages } from "@/lib/server/transcript";

/**
 * Turn a finished 壁打ち into one STAR + 学び + 感情 episode.
 *
 * The client posts the transcript it already has on screen rather than the
 * server re-reading it from Firestore, for the same reason as /api/chat: the
 * student can only feed it their own words, so there is nothing to protect
 * against that would justify server-side credentials.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TAGS: readonly string[] = EPISODE_TAGS;

/**
 * The one tool, and the only thing the model is allowed to do with this turn.
 *
 * The cast is the seam between a plain-JSON schema and the SDK's own type: the
 * prompts directory stays free of SDK imports so the rollback path and the
 * offline checks can read it without one.
 */
const EPISODE_TOOL: Tool = {
  name: EPISODE_TOOL_NAME,
  description:
    "壁打ちのログから抽出した、学生本人の言葉によるエピソードを1件保存する。",
  input_schema: EPISODE_TOOL_INPUT_SCHEMA as unknown as Tool.InputSchema,
};

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Never trust the model's shape, even with a schema attached to the tool. */
function normalize(raw: unknown): ExtractedEpisode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const star = (r.star ?? {}) as Record<string, unknown>;

  const episode: ExtractedEpisode = {
    title: str(r.title, 200),
    tag: ALLOWED_TAGS.includes(str(r.tag, 20)) ? str(r.tag, 20) : "その他",
    emotion: str(r.emotion, 100),
    star: {
      S: str(star.S, 1000),
      T: str(star.T, 1000),
      A: str(star.A, 1000),
      R: str(star.R, 1000),
    },
    learn: str(r.learn, 2000),
  };

  // A card with no title and no situation is not an episode — better to tell
  // the student the conversation was too short than to save an empty shell.
  if (!episode.title && !episode.star.S) return null;
  if (!episode.title) episode.title = "名前のないエピソード";

  return episode;
}

export async function POST(request: Request) {
  const uid = await verifyRequestUid(request);
  if (!uid) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (isRateLimited(uid)) {
    return Response.json(
      { error: "少し早すぎるようです。数秒おいてからもう一度お試しください。" },
      { status: 429 },
    );
  }

  let transcript;
  try {
    const body = (await request.json()) as { messages?: unknown };
    transcript = parseMessages(body.messages);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  if (transcript.filter((m) => m.role === "user").length === 0) {
    return Response.json(
      {
        error: "まだあなたの言葉が残っていません。少し話してから試してください。",
      },
      { status: 400 },
    );
  }

  let input: unknown;

  try {
    const message = await callAnthropic("api/extract", () =>
      getAnthropic().messages.create({
        model: EXTRACT_MODEL,
        max_tokens: EXTRACT_MAX_TOKENS,
        system: EXTRACTION_SYSTEM_PROMPT,
        // The whole conversation matters here in a way it does not for a single
        // turn: the job is to pick the one episode the student told best, so the
        // window is the full transcript parseMessages allows.
        messages: [
          { role: "user", content: buildExtractionPrompt(historyWindow(transcript, 20)) },
        ],
        tools: [EPISODE_TOOL],
        // Forced, so there is no path where the model answers in prose and the
        // route has to guess whether the prose was meant to be the card.
        tool_choice: { type: "tool", name: EPISODE_TOOL_NAME },
      }),
    );

    // Safety classifiers answer with HTTP 200 and no usable content, so this is
    // checked before anything reads `content`.
    if (message.stop_reason === "refusal") {
      console.error("[api/extract] refused", message.stop_details);
      return Response.json(
        { error: "この会話からはエピソードをまとめられませんでした。" },
        { status: 422 },
      );
    }

    // Truncation is not the same failure as a conversation with nothing in it,
    // and telling the student to talk more would be the wrong instruction.
    if (message.stop_reason === "max_tokens") {
      console.error("[api/extract] response truncated", { usage: message.usage });
      return Response.json(
        { error: "まとめが長くなりすぎました。もう一度お試しください。" },
        { status: 502 },
      );
    }

    const call = message.content.find((block) => block.type === "tool_use");
    input = call?.input;
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
    console.error("[api/extract] unexpected failure", e);
    return Response.json(
      { error: "抽出に失敗しました。もう一度お試しください。" },
      { status: 502 },
    );
  }

  const episode = normalize(input);

  if (!episode) {
    return Response.json(
      {
        error:
          "エピソードとして残せる具体的な話がまだ足りないようです。もう少し壁打ちを続けてみてください。",
      },
      { status: 422 },
    );
  }

  return Response.json({ episode });
}
