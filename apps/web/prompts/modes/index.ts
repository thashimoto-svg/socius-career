import { blocksToText, type PromptBlock } from "../cache";
import { INVARIANT_CORE, profileBlock, type PromptProfile } from "./core";
import { TONES, type ToneId } from "./tones";

export { INVARIANT_CORE, profileBlock, TONES };
export type { PromptProfile, ToneId };

/**
 * The system prompt, split at the line where it stops being the same for
 * everybody.
 *
 * Two layers, in that order, and the order is the whole point:
 *
 *   1. 深掘り層 + トーン層 — identical for every student on that tone. There are
 *      two possible values of this block in the entire product.
 *   2. オンボーディング注入部 + 今日のテーマ — this student, this 壁打ち.
 *
 * Both get a cache breakpoint, because they are reused by different people.
 * The first is shared across the whole beta cohort, so one student's first
 * message keeps it warm for the next student's; the second is reused by one
 * student across the turns of one conversation, which is the denser pattern
 * but a much smaller audience. Having both means a turn hits whichever is
 * still warm.
 *
 * ── Why the profile moved after the tone ──
 * It used to sit between the core and the tone. That ordering makes layer 1
 * uncacheable: the prefix ending at the core alone measures 643 tokens, under
 * the 1024-token floor, so a breakpoint there would silently do nothing, and a
 * breakpoint after the profile would key the cache to one student. Moving the
 * profile down puts 1,224 shared tokens in front of it. The text of every layer
 * is unchanged — this is a reordering, not a rewrite — and it reads at least as
 * well: the rules, then the manner, then who is on the other side.
 */
export function buildChatSystemBlocks(opts: {
  profile: PromptProfile | null;
  mode: ToneId;
  theme?: string;
}): PromptBlock[] {
  const themeBlock = opts.theme
    ? `\n\n【今日のテーマ】\n${opts.theme}\nこのテーマから逸れそうなときは、自然に引き戻してください。`
    : "";

  return [
    {
      type: "text",
      text: `${INVARIANT_CORE}\n\n${TONES[opts.mode].instruction}`,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: profileBlock(opts.profile) + themeBlock,
      cache_control: { type: "ephemeral" },
    },
  ];
}

/**
 * The same prompt as one string.
 *
 * Kept because two things still want it: the offline guard scripts, which
 * assert on the assembled text, and lib/server/gemini.ts, whose API has no
 * concept of a cache breakpoint. Defined in terms of the blocks so the rollback
 * path cannot drift from what Claude is actually sent.
 */
export function buildChatSystemPrompt(opts: {
  profile: PromptProfile | null;
  mode: ToneId;
  theme?: string;
}): string {
  return blocksToText(buildChatSystemBlocks(opts));
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
