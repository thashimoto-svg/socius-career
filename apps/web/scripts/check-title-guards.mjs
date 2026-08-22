/**
 * Offline checks for the 壁打ち title the 履歴 list is read by.
 *
 * A title is generated from the student's first message, by rule rather than
 * by asking the model — a summary request per conversation is a request out of
 * a daily cap that exists to keep the β affordable, spent on a string whose
 * only job is to let someone pick the right row out of a list of five.
 *
 * Rules bought instead of tokens means the rules have to be right, and the
 * ways they go wrong are quiet: a title is never *broken*, it is just useless,
 * and nobody files that. So this file writes down what each rule is for and
 * what it must not eat.
 *
 * The properties, in the order they matter:
 *
 *   1. A title never begins with hesitation. 「えっと、」 at the front of every
 *      row is as informative as no title at all, and it spends the widest
 *      characters in a 24-character budget saying nothing.
 *   2. A title never ends mid-phrase. 「高校の部活の」 is not a shorter title
 *      than 「高校の部活」; it is the same one, looking broken.
 *   3. Stripping never leaves nothing. A message that is *only* hesitation
 *      still has to come out of this with a name on it.
 *   4. Words are not eaten. 「あの人」 begins with 「あの」 and is not a filler,
 *      and 「〜のに」 ends with 「に」 and is not a dangling particle.
 *
 *   npm run check:title
 */
import { PLACEHOLDER_TITLE, titleFromFirstMessage } from "../prompts/modes/index.ts";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function titled(input, expected) {
  const actual = titleFromFirstMessage(input);
  check(
    `「${input.length > 30 ? `${input.slice(0, 30)}…` : input}」 → 「${expected}」`,
    actual === expected,
    `got 「${actual}」`,
  );
}

console.log("\n言いよどみ — 話し始めの音は題ではない");
titled("えっと、高校の部活の話なんですけど", "高校の部活の話なんですけど");
titled("あの、就活が不安です。", "就活が不安です");
titled("なんか、自分の強みがわからなくて", "自分の強みがわからなくて");
titled("まあ、バイトの話でもします", "バイトの話でもします");

console.log("\n言いよどみ — 消してはいけないもの");
titled("あの人に言われたことが忘れられない", "あの人に言われたことが忘れられない");
titled("えっとかあのとか言いがちです", "えっとかあのとか言いがちです");

console.log("\n文の切れ目 — 最初の一文で名前がついているなら、そこで止める");
titled("部活の話です。実は去年、後輩とうまくいかなくて", "部活の話です");
titled("就活、まだ何も決まってません!", "就活、まだ何も決まってません");

console.log("\n長すぎるとき — 読点で切れるならそこで切る");
titled(
  "えっと、高校の部活の話なんですけど、3年間ずっと副キャプテンをやっていました",
  "高校の部活の話なんですけど",
);
titled(
  "大学生になってから何をしたらいいのか全然わからなくなってしまいました",
  "大学生になってから何をしたらいいのか全然わからな…",
);

console.log("\n語尾 — 助詞や記号で終わらせない");
titled(
  "サッカー部で三年間ずっと補欠だった自分の話をしたいのですが",
  "サッカー部で三年間ずっと補欠だった自分の話をした…",
);

console.log("\n端の条件 — 名前のつかない一言でも名前はつく");
titled("", PLACEHOLDER_TITLE);
titled("   ", PLACEHOLDER_TITLE);
titled("えっと、", PLACEHOLDER_TITLE);
titled("。。。", PLACEHOLDER_TITLE);
titled("はい", "はい");

console.log("\n長さ — 一覧の一行に収まる");
for (const sample of [
  "えっと、高校の部活の話なんですけど、3年間ずっと副キャプテンをやっていました",
  "大学生になってから何をしたらいいのか全然わからなくなってしまいました",
  "あ".repeat(200),
]) {
  const title = titleFromFirstMessage(sample);
  check(`25文字以内: 「${title}」`, title.length <= 25, `${title.length}文字`);
}

console.log(
  failures === 0 ? "\n✅ すべて通りました\n" : `\n❌ ${failures} 件失敗しました\n`,
);
process.exit(failures === 0 ? 0 : 1);
