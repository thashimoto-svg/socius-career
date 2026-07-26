import { INVARIANT_CORE, profileBlock, type PromptProfile } from "./core";
import { TONES, type ToneId } from "./tones";

export { INVARIANT_CORE, profileBlock, TONES };
export type { PromptProfile, ToneId };

/** System instruction for an ongoing 壁打ち turn. */
export function buildChatSystemPrompt(opts: {
  profile: PromptProfile | null;
  mode: ToneId;
  theme?: string;
}): string {
  const themeBlock = opts.theme
    ? `\n\n【今日のテーマ】\n${opts.theme}\nこのテーマから逸れそうなときは、自然に引き戻してください。`
    : "";

  return [
    INVARIANT_CORE,
    profileBlock(opts.profile),
    TONES[opts.mode].instruction + themeBlock,
  ].join("\n\n");
}

/**
 * The first line of a brand-new session.
 *
 * 「上部の対話テーマは初回はガイド付き(答えやすい問いから段階的に深掘り)」 —
 * the opening question has to be answerable in one sentence, because a student
 * who cannot answer the first question does not reach the second.
 *
 * Sent as the user turn, with buildChatSystemPrompt() still in the system
 * slot, so the opening obeys the same invariants as every later reply.
 */
export function buildOpeningInstruction(): string {
  return `これは最初の一言です。まだ学生は何も話していません。
次の条件で、話しかけてください。

- 100字程度。挨拶は一言だけ。
- 自己分析の説明や進め方の案内はしない。
- オンボーディングの回答に触れて、そこから答えやすい事実を一つだけ聞く。
- 「あなたの強みは?」のような大きい問いから始めない。
  まず思い出せる具体的な出来事を聞く。
- 最後は必ずひとつの問いで終える。
- プレーンな日本語の文章のみ。箇条書きや見出しは使わない。`;
}

/** 「今日のテーマ」 shown above the transcript for a fresh session. */
export function defaultTheme(profile: PromptProfile | null): string {
  if (!profile?.club || profile.club === "特に思いつかない") {
    return "これまでで印象に残っている出来事";
  }
  return `${profile.club}の経験`;
}

/** A session title derived from the student's first message. */
export function titleFromFirstMessage(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= 24 ? line : `${line.slice(0, 24)}…`;
}
