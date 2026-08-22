/**
 * 選択肢 — 白紙の入力欄の前で止まってしまう学生のための、答え方の見本。
 *
 * βフィードバック 8/18: 「何を書けばいいか分からなくて止まる」。ルール7はすでに
 * 「学生が詰まったら、選びやすい切り口を2〜3個示して問い直す」と言っていて、AIは
 * 実際そうしていた——ただし文章の中で。「部活のことでも、バイトのことでも、
 * 授業のことでも構いません」は、読むぶんには親切だが、入力欄の前では選択肢に
 * 見えない。同じ三つを押せる形で出すと、一手で会話が進む。
 *
 * 押した選択肢はそのまま学生の発言として送られる。入力欄はいつでも空いていて、
 * 選択肢はあくまで見本——「その他」を用意していないのはそのためで、自由記述が
 * 常に隣にあるものに「その他」を足すと、選ぶことが義務のように見える。
 */

import { blockOf } from "./tags";

/** How many chips fit under a bubble on a phone without becoming a menu. */
export const CHOICES_MAX = 4;

/** 一つの選択肢の長さ。押せる幅に収まらないものは選択肢ではない。 */
export const CHOICE_MAX_LENGTH = 40;

/** 区切り。全角の縦棒も読む。 */
const SPLIT = /[|｜]/;

/**
 * The choices a reply offered, or an empty list.
 *
 * An unterminated block is not a block yet (see blockOf): half a list of
 * options is worse than none, because the half that arrived looks complete.
 */
export function parseChoices(reply: string): string[] {
  const body = blockOf(reply, "choices");
  if (body === null) return [];

  const seen = new Set<string>();
  const choices: string[] = [];
  for (const raw of body.split(SPLIT)) {
    const choice = raw.replace(/\s+/g, " ").trim();
    if (!choice || choice.length > CHOICE_MAX_LENGTH) continue;
    if (seen.has(choice)) continue;
    seen.add(choice);
    choices.push(choice);
    if (choices.length === CHOICES_MAX) break;
  }
  // One option is not a choice; it is an instruction with a button on it.
  return choices.length >= 2 ? choices : [];
}

/** Firestore hands back whatever is in the document; keep only real choices. */
export function toChoices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= CHOICE_MAX_LENGTH)
    .slice(0, CHOICES_MAX);
}

/**
 * The instruction that produces the block.
 *
 * Joins the shared, cached half of the system prompt: the protocol is the same
 * for every student on every tone.
 */
export const CHOICES_PROTOCOL = `【選択肢】(システム用・タグ自体は学生には表示されない)
本文の問いが、学生にとって答えにくいかもしれないとき——まだ何を話すか決まって
いないとき、抽象的な問いを投げざるを得ないとき、詰まっている様子のとき——だけ、
本文のあとに答え方の見本を並べられます。

[choices] 選択肢1 | 選択肢2 | 選択肢3 [/choices]

- 2〜${CHOICES_MAX}個。1個だけなら出さない。
- 一つ${CHOICE_MAX_LENGTH}字以内。学生がそのまま口にできる言葉で書く。
  「部活の話」「アルバイトの話」のように、答えそのものの形にする。
- 「その他」「特にない」は入れない。入力欄はいつでも空いていて、学生は選ばずに
  書くこともできます。
- **毎回は出さない。** 具体的な事実を聞いている問い(「そのとき何をしましたか」)に
  選択肢を付けると、学生は自分の経験ではなくこちらの用意した言葉から選びます。
  それは自己分析ではありません。
- 本文では選択肢に言及しない。「次の中から選んでください」とは書かない。押せる形で
  下に出るので、本文は問いで終えるだけでよい。`;
