import {
  buildChatSystemPrompt,
  buildOpeningInstruction,
  type PromptProfile,
  type ToneId,
} from "@socius/prompts";
import { isRateLimited, verifyRequestUid } from "@/lib/server/auth";
import {
  CHAT_MODEL,
  getGemini,
  parseMessages,
  toGeminiContents,
} from "@/lib/server/gemini";

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

  try {
    const response = await getGemini().models.generateContent({
      model: CHAT_MODEL,
      contents: opening
        ? [{ role: "user", parts: [{ text: buildOpeningInstruction() }] }]
        : toGeminiContents(messages),
      config: {
        systemInstruction: buildChatSystemPrompt({ profile, mode, theme }),
        temperature: 0.9,
        maxOutputTokens: 800,
        // A coaching question does not need a long deliberation, and latency
        // between turns is what makes a 壁打ち feel like a conversation.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const text = response.text?.trim();
    if (!text) {
      return Response.json(
        { error: "返答を受け取れませんでした。もう一度お試しください。" },
        { status: 502 },
      );
    }

    return Response.json({ text });
  } catch (e) {
    console.error("[api/chat] Gemini call failed", e);
    return Response.json(
      { error: "AIの応答に失敗しました。時間をおいてもう一度お試しください。" },
      { status: 502 },
    );
  }
}
