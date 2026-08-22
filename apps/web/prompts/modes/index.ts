import { blocksToText, type PromptBlock } from "../cache";
import { PROGRESS_PROTOCOL } from "../progress";
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
      // The progress protocol belongs in here rather than in the per-student
      // block below: it is byte-identical for the whole cohort on both tones,
      // so it rides the cache that is already warm instead of paying for
      // itself on every conversation. Last, because it is the one thing in
      // this block that is not about how to talk to the student.
      type: "text",
      text: `${INVARIANT_CORE}\n\n${TONES[opts.mode].instruction}\n\n${PROGRESS_PROTOCOL}`,
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

/**
 * The placeholder a 壁打ち is created with, and what a title falls back to.
 *
 * Exported so the chat screen and the 履歴 rename can both recognise it — one
 * to know a title is still up for grabs, the other to know an emptied box is
 * not a title.
 */
export const PLACEHOLDER_TITLE = "新しい壁打ち";

/** How long a title in the 履歴 list can be before it is cut. */
const TITLE_MAX = 24;

/**
 * Openings that are not what the conversation is about.
 *
 * People do not start talking at the start of the sentence. 「えっと、」 and
 * 「あの、」 are the sound of someone deciding what to say, and putting them at
 * the front of a title spends the widest characters in the list on the one
 * part of the message that carries nothing — every row in the 履歴 begins with
 * the same noise, which is exactly as useful as no title at all.
 *
 * Only stripped from the front, only once around, and only when something is
 * left afterwards: a message that is nothing but hesitation still has to end
 * up with a name.
 */
const FILLERS = [
  "えっと", "えーっと", "ええと", "えと", "あの", "あのー", "あのう",
  "そのー", "うーん", "うーんと", "なんか", "なんていうか", "まあ", "まぁ",
  "はい", "あ", "え", "お",
];

/** Sentence ends, in the order a title would rather stop at. */
const SENTENCE_END = /[。．.!?！？]/;

/**
 * Trailing characters a title must not end on.
 *
 * A cut lands wherever the character count runs out, which in Japanese is
 * usually mid-phrase — 「高校の部活の」 is not a shorter title than 「高校の
 * 部活」, it is the same title that looks broken. Particles and punctuation
 * come off the end until it stops on something that carries meaning.
 */
const DANGLING = /[\s、,・…。．.？?！!]+$/;
const DANGLING_PARTICLE = /(?:の|は|が|を|に|で|と|も|や|へ|から|まで|より|って|という)$/;

function stripFillers(line: string): string {
  let out = line;
  // Repeated, because hesitation comes in runs — 「えっと、あの、」 is one pause,
  // not two. Bounded by the list length so a pathological input cannot spin.
  for (let pass = 0; pass < FILLERS.length; pass += 1) {
    const before = out;
    for (const filler of FILLERS) {
      // The 「、」 is what marks it as hesitation. 「あの人」 begins with 「あの」
      // and is a person; 「あの、」 is always someone deciding what to say.
      // Without the comma this rule would eat the first word of the title it
      // is supposed to be improving.
      const prefix = new RegExp(`^${filler}[、,]\\s*`);
      if (prefix.test(out)) {
        out = out.replace(prefix, "");
        break;
      }
    }
    if (out === before) break;
  }
  // Empty is a real answer: a message that was nothing but hesitation has
  // nothing in it to name the conversation after, and the caller has a
  // placeholder for exactly that.
  return out;
}

function trimDangling(line: string): string {
  let out = line.replace(DANGLING, "");
  // One particle, not a loop: 「〜のに」 is two of these back to back and is
  // also a real ending. Taking them off until nothing matches would eat words.
  const shorter = out.replace(DANGLING_PARTICLE, "");
  if (shorter.length >= 2) out = shorter;
  return out.replace(DANGLING, "");
}

/**
 * A session title derived from the student's first message.
 *
 * Rule-based on purpose. The obvious alternative is to ask the model for a
 * summary, which reads better and costs a request per 壁打ち against a daily
 * cap that exists to keep the β affordable — for a string whose job is to let
 * someone pick the right row out of a list of five. Between that and 「えっと、
 * 高校の部活の話なんですけど、3年間ず…」, most of the distance is closed by not
 * printing the hesitation and not stopping mid-particle.
 *
 * The student can rename it from 履歴 either way, which is the real answer to
 * a title that came out wrong.
 */
export function titleFromFirstMessage(text: string): string {
  const line = stripFillers(text.replace(/\s+/g, " ").trim());
  if (!line) return PLACEHOLDER_TITLE;

  // The first sentence, when there is one and it is not longer than the cap.
  // A student who wrote 「部活の話です。実は去年…」 named the conversation in
  // their first breath; there is no reason to run past it into the second.
  const end = line.search(SENTENCE_END);
  const sentence = end > 0 && end <= TITLE_MAX ? line.slice(0, end) : line;

  if (sentence.length <= TITLE_MAX) return trimDangling(sentence) || PLACEHOLDER_TITLE;

  // Too long. Prefer the last clause break inside the budget over the budget
  // itself — 「高校の部活の話なんですけど、」 ends where the student paused, and
  // a cut there needs no 「…」 to explain itself.
  const head = sentence.slice(0, TITLE_MAX);
  const clause = Math.max(head.lastIndexOf("、"), head.lastIndexOf(","));
  if (clause >= 6) return trimDangling(head.slice(0, clause)) || PLACEHOLDER_TITLE;

  const cut = trimDangling(head);
  return cut ? `${cut}…` : PLACEHOLDER_TITLE;
}
