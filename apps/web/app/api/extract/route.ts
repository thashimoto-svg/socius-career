import {
  buildExtractionPrompt,
  EPISODE_RESPONSE_SCHEMA,
  EPISODE_TAGS,
  EXTRACTION_SYSTEM_PROMPT,
  type ExtractedEpisode,
} from "@socius/prompts";
import { isRateLimited, verifyRequestUid } from "@/lib/server/auth";
import {
  callGemini,
  EXTRACT_MODEL,
  getGemini,
  historyWindow,
  isGeminiFailure,
  parseMessages,
} from "@/lib/server/gemini";

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

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Never trust the model's shape, even with a response schema attached. */
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

  let text: string | undefined;

  try {
    const response = await callGemini("api/extract", () =>
      getGemini().models.generateContent({
        model: EXTRACT_MODEL,
        // The whole conversation matters here in a way it does not for a single
        // turn: the job is to pick the one episode the student told best, so the
        // window is the full transcript parseMessages allows. Twenty 往復 is
        // about 3,500 input tokens — no need to split or summarise anything.
        contents: buildExtractionPrompt(historyWindow(transcript, 20)),
        config: {
          systemInstruction: EXTRACTION_SYSTEM_PROMPT,
          responseMimeType: "application/json",
          // The schema is plain JSON so @socius/prompts stays SDK-independent.
          responseSchema: EPISODE_RESPONSE_SCHEMA as never,
          // Low but non-zero: picking which sentence belongs in which slot is a
          // judgement call, inventing a nicer sentence is not.
          temperature: 0.2,
          // Thinking tokens are spent out of the output allowance, and 2.5
          // Flash thinks by default. The old 2,000 with no thinkingConfig meant
          // a long transcript could think its way through the entire budget and
          // return JSON cut off mid-string — which arrived as a parse error and
          // was reported as 「抽出に失敗しました」. Both are now explicit, and
          // the ceiling covers a fully populated STAR card.
          thinkingConfig: { thinkingBudget: 1024 },
          maxOutputTokens: 6000,
        },
      }),
    );

    text = response.text?.trim();

    // Truncation is not the same failure as a conversation with nothing in it,
    // and telling the student to talk more would be the wrong instruction.
    if (response.candidates?.[0]?.finishReason === "MAX_TOKENS") {
      console.error("[api/extract] response truncated", {
        usage: response.usageMetadata,
      });
      return Response.json(
        { error: "まとめが長くなりすぎました。もう一度お試しください。" },
        { status: 502 },
      );
    }
  } catch (e) {
    if (isGeminiFailure(e)) {
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

  let episode: ExtractedEpisode | null = null;
  try {
    episode = text ? normalize(JSON.parse(text)) : null;
  } catch (e) {
    console.error("[api/extract] response was not JSON", e);
    return Response.json(
      { error: "まとめを読み取れませんでした。もう一度お試しください。" },
      { status: 502 },
    );
  }

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
