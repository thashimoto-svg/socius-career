/**
 * 一つの返答を、学生が読むものと機械が読むものに分ける唯一の場所。
 *
 * 返答は本文で終わらない。そのあとに選択肢とエピソードシートが続き、どちらも
 * 学生には見えてはならない。剥がす処理が二箇所にあると、片方だけ直された日に
 * 「[sheet]」が吹き出しの中に出る——このアプリの前提(誰かと話している)が、記号
 * 一つで崩れる種類の失敗なので、入口を一つにしてある。
 *
 * 画面もFirestoreも次の依頼の履歴も、ここを通ったあとの text しか見ない。
 */

import { parseChoices } from "./choices";
import { stripTags } from "./tags";
import { parseWorksheet, type Worksheet } from "./worksheet";

export type ReadReply = {
  /** 学生が読む本文。タグは完全形も途中形も落ちている。 */
  text: string;
  /** この回のシート更新。ブロックが無ければ null(＝「変わっていない」)。 */
  sheet: Partial<Worksheet> | null;
  /** 押せる形で出す答え方の見本。無ければ空。 */
  choices: string[];
};

/** Split a finished reply into what is shown and what it reported. */
export function readReply(raw: string): ReadReply {
  return {
    text: stripTags(raw),
    sheet: parseWorksheet(raw),
    choices: parseChoices(raw),
  };
}

/**
 * What the student sees while the reply is still arriving.
 *
 * The same cut readReply makes, on a prefix — a reply is rendered as it
 * streams, so 「[sheet」 would otherwise be on screen for as long as the next
 * chunk takes to land.
 */
export { stripTags as stripReply };
