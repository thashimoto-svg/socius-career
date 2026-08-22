/**
 * 構造タグ — 返答に混ぜて運ばれる、学生に見せないもの。
 *
 * 進捗マーカー([progress:situation])が一つだけだった頃は、書式もそれを剥がす
 * コードも progress.ts の中で完結していた。運ぶものが増えた——エピソードシート
 * (worksheet.ts)と選択肢(choices.ts)——ので、「どういう括弧で囲むか」と「それを
 * どう剥がすか」だけをここに降ろしてある。
 *
 * 守るべき性質は一つで、マーカーの頃から変わらない:
 *
 *   **返答のどの途中経過を描画しても、タグもその一部も画面に出ない。**
 *
 * 返答は流れながら描かれるので、「[sh」だけが届いている瞬間が必ずある。完成した
 * 返答を綺麗にするのは簡単で、危ないのはそこではない。だから剥がす側は、閉じタグ
 * が来ていない状態・開き括弧しか来ていない状態・閉じタグだけが来た状態のすべてを
 * 「これは本文ではない」と判定できなければならない。
 *
 * この規約と、それを剥がすコードが同じファイルに入っているのはそのためで、
 * 片方だけ書き換えると壊れる。
 */

/** The tags a reply may carry, in the order they are written. */
export const TAGS = ["choices", "sheet"] as const;

export type Tag = (typeof TAGS)[number];

const TAG_ALTERNATION = TAGS.join("|");

/**
 * Any complete tag — opening or closing.
 *
 * Deliberately forgiving about the things a Japanese model gets wrong on the
 * way to the right answer: 全角の括弧, stray spaces, a slash with a space after
 * it. A tag that arrives in a shape we do not recognise is a tag the student
 * reads, which is the one failure this file exists to prevent.
 */
const ANY_TAG = new RegExp(`[[［]\\s*/?\\s*(?:${TAG_ALTERNATION})\\s*[\\]］]`, "i");

/**
 * A tag that has only half arrived.
 *
 * Anything from an opening bracket to the end of the text, made only of the
 * characters a tag can contain before its closing bracket. Japanese prose does
 * not produce that shape, and rule 9 tells the model not to use brackets at
 * all.
 */
const PARTIAL_TAG = /[[［][a-zA-Z/／:：\s]{0,16}$/;

/**
 * The body — everything before the first tag of any kind.
 *
 * A cut rather than a removal, and that is the point. Every tag block sits
 * after the reply, so the first tag is where the student's half of the message
 * ends; anything following it is machinery, including whatever the model put
 * between two blocks. Removing the blocks individually would leave a reply that
 * looks clean until the model writes something in the gap.
 */
export function stripTags(text: string): string {
  const found = text.match(ANY_TAG);
  const body = found ? text.slice(0, found.index) : text;
  return body.replace(PARTIAL_TAG, "").trimEnd();
}

/**
 * What one complete block contains, or null.
 *
 * The closing tag is required. A block that has not finished arriving is not a
 * block yet — for the sheet that means one turn's update is skipped, which
 * merges to the same thing as a turn that said nothing new, and for the choices
 * it means no chips rather than half a list of them.
 */
export function blockOf(text: string, tag: Tag): string | null {
  const pattern = new RegExp(
    `[[［]\\s*${tag}\\s*[\\]］]([\\s\\S]*?)[[［]\\s*/\\s*${tag}\\s*[\\]］]`,
    "i",
  );
  const found = text.match(pattern);
  return found ? found[1] : null;
}

/** `key: value` out of a block body, keeping only the keys asked for. */
export function fieldsOf(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of body.split("\n")) {
    // 全角コロン as well: the model writes one about as often as it writes the
    // half-width version, and a dropped line is a field that silently stops
    // being carried between turns.
    const at = line.search(/[:：]/);
    if (at <= 0) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    if (!/^[a-z]+$/.test(key)) continue;
    fields.set(key, line.slice(at + 1).trim());
  }
  return fields;
}
