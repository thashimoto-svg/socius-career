/**
 * Offline checks for the two decisions automatic extraction makes on its own.
 *
 * Both are cheap to get wrong in a way nobody notices for a while: a duplicate
 * check that is too loose merges two of the student's stories into one card, and
 * a trigger gate that is too eager spends a request every time the app is
 * brought back to the foreground.
 *
 *   node --experimental-strip-types --import ./scripts/ts-resolve.mjs \
 *     scripts/check-extraction-guards.mjs
 */
import {
  isSameEpisode,
  SAME_EPISODE_THRESHOLD,
  titleSimilarity,
} from "../lib/similarity.ts";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const same = (a, b) =>
  check(
    `同じ話として扱う: 「${a}」 / 「${b}」`,
    isSameEpisode(a, b),
    `類似度 ${titleSimilarity(a, b).toFixed(2)} < ${SAME_EPISODE_THRESHOLD}`,
  );

const different = (a, b) =>
  check(
    `別の話として扱う: 「${a}」 / 「${b}」`,
    !isSameEpisode(a, b),
    `類似度 ${titleSimilarity(a, b).toFixed(2)} >= ${SAME_EPISODE_THRESHOLD}`,
  );

// ---------------------------------------------------------------------------
console.log("\n重複判定 — 同じ出来事を2枚のカードにしない");
// ---------------------------------------------------------------------------

same("サッカー部で集合時間を前倒しにした話", "サッカー部で集合時間を前倒しにした話");
same("サッカー部で集合時間を前倒しにした話", "サッカー部で、集合時間を前倒しにした話。");
same("集合時間を10分前倒しにした提案", "集合時間を10分前倒しにした提案とその結果");
same("副キャプテンとしての練習改革", "副キャプテンとしての練習改革");

// The same words in a different order is still the same episode — which is
// what bigram overlap buys over prefix matching.
same("バイトの新人が辞めそうなときの声かけ", "新人が辞めそうなときのバイトでの声かけ");

// ---------------------------------------------------------------------------
console.log("\n重複判定 — 別の出来事は別のカードのまま");
// ---------------------------------------------------------------------------

different("サッカー部で集合時間を前倒しにした話", "居酒屋のバイトで新人の相談に乗った話");
different("ゼミで発表資料を作り直した経験", "サッカー部の副キャプテン");
different("集合時間の前倒し", "リーグ5位という結果");

// A shared setting is not a shared episode. This is the pair the threshold is
// actually tuned against: both are 部活, both are the same person, and they are
// still two different things that happened.
different("部活で後輩の練習メニューを作った話", "部活で会計を任されて予算を組み直した話");

// ---------------------------------------------------------------------------
console.log("\n重複判定 — 端の条件");
// ---------------------------------------------------------------------------

check("空文字は何とも一致しない", !isSameEpisode("", "サッカー部の話"));
check("両方空でも一致にしない", !isSameEpisode("", ""));
check("完全一致は1.0", titleSimilarity("同じ", "同じ") === 1);
check("全角と半角の違いは無視する", isSameEpisode("ＴＯＥＩＣの勉強", "TOEICの勉強"));
check("類似度は0〜1に収まる", [
  ["a", "b"],
  ["サッカー", "サッカー部"],
  ["", "x"],
].every(([a, b]) => {
  const s = titleSimilarity(a, b);
  return s >= 0 && s <= 1;
}));

console.log(
  failures === 0 ? "\n✅ すべて通りました\n" : `\n❌ ${failures} 件失敗しました\n`,
);
process.exit(failures === 0 ? 0 : 1);
