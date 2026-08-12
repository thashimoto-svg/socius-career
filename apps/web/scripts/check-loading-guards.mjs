/**
 * Offline checks for the thing that made 「読み込んでいます…」 permanent.
 *
 * The bug was never a missing catch. The Firestore SDK treats an unreachable
 * backend as something to keep retrying rather than something to fail, so the
 * promise a screen is waiting on simply never settles — no rejection, no catch,
 * no error state, no way out. The only fix is a deadline, and the only way it
 * stays fixed is if every screen has one.
 *
 * So this asserts both halves: that the deadline behaves, and that nothing
 * loads a screen without it.
 *
 *   node --experimental-strip-types --import ./scripts/ts-resolve.mjs \
 *     scripts/check-loading-guards.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { LOAD_TIMEOUT_MS, withTimeout } from "../lib/with-timeout.ts";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const never = () => new Promise(() => {});

// ---------------------------------------------------------------------------
console.log("\nwithTimeout — 決して返らない約束に締め切りを与える");
// ---------------------------------------------------------------------------

const rejected = await withTimeout(never(), 20, "時間切れ").then(
  () => null,
  (e) => e,
);
check("返らない promise は締め切りで失敗する", rejected instanceof Error);
check(
  "失敗の文言は呼び出し側が決める",
  rejected?.message === "時間切れ",
  `受け取った文言: ${rejected?.message}`,
);

check(
  "間に合えば値はそのまま通る",
  (await withTimeout(Promise.resolve("値"), 1000, "時間切れ")) === "値",
);

const original = await withTimeout(
  Promise.reject(new Error("権限がありません")),
  1000,
  "時間切れ",
).then(
  () => null,
  (e) => e,
);
check(
  "本来の失敗は締め切りに置き換えられない",
  original?.message === "権限がありません",
  `受け取った文言: ${original?.message}`,
);

// 10秒は「遅い回線」と「壊れている」を分ける線。短すぎると届く途中で諦める。
check(
  "共通の締め切りは5〜15秒に収まっている",
  LOAD_TIMEOUT_MS >= 5_000 && LOAD_TIMEOUT_MS <= 15_000,
  `${LOAD_TIMEOUT_MS}ms`,
);

// ---------------------------------------------------------------------------
console.log("\n全画面 — 素手でデータを取っている画面はない");
// ---------------------------------------------------------------------------

const SCREENS = new URL("../app/(main)/", import.meta.url);

// 名前で数える。useLoadable には関数を「呼ばずに」渡す画面もあるので、
// 呼び出しの形（末尾の括弧）で探すと取りこぼす。
const LOADERS = [
  "listEpisodes",
  "listSessions",
  "openChat",
  "getUserDoc",
  "getSettings",
];

/**
 * 取得しているなら、締め切りと再試行を持っていること。
 *
 * withTimeout を直に呼ぶのも可 — settings provider のように、失敗しても
 * 既定値で動く読み込みに画面用のエラー UI は要らない。禁じたいのは素手、
 * つまりどちらも通していない取得だけ。
 */
function auditLoads(label, source) {
  if (!LOADERS.some((name) => source.includes(name))) {
    console.log(`  --   ${label} は自分でデータを取っていない`);
    return;
  }

  const bounded = source.includes("useLoadable") || source.includes("withTimeout");
  check(`${label} は締め切りつきで読み込む`, bounded, "素手の読み込みが残っている");

  if (source.includes("useLoadable")) {
    check(
      `${label} は失敗を再試行つきで見せる`,
      source.includes("ScreenError"),
      "エラー時に student のやることがない",
    );
  }
}

for (const dir of readdirSync(SCREENS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;

  let source;
  try {
    source = readFileSync(new URL(`${dir.name}/page.tsx`, SCREENS), "utf8");
  } catch {
    continue;
  }

  // 設定画面は provider から読む — 自前の取得をしていない画面に
  // useLoadable を強制しても意味がない。
  auditLoads(`/${dir.name}`, source);
}

// ---------------------------------------------------------------------------
console.log("\n部品 — 画面でなくても、取得しているなら締め切りがある");
// ---------------------------------------------------------------------------

// ドロワーは画面ではないので page.tsx の巡回に入らず、素手の listSessions が
// 一つだけ残っていた。開くたび 「読み込んでいます…」 のまま戻らなくなる場所が、
// 画面と同じだけあるということ。app/ の外も同じ規則で見る。
const COMPONENTS = new URL("../components/", import.meta.url);

for (const file of readdirSync(COMPONENTS, { withFileTypes: true })) {
  if (!file.isFile() || !file.name.endsWith(".tsx")) continue;
  auditLoads(file.name, readFileSync(new URL(file.name, COMPONENTS), "utf8"));
}

// ---------------------------------------------------------------------------
console.log("\n入口 — 全画面が待っている門にも締め切りがある");
// ---------------------------------------------------------------------------

// 画面ごとの締め切りは全部そろっていたのに、症状だけが戻ってきた。全画面が
// RequireAuth の後ろにあり、その loading は onAuthStateChanged のコールバックの
// 中でしか下りない。Firebase は保存済みセッションを IndexedDB から読むので、
// ストレージが塞がれた環境ではコールバック自体が来ない。来なければ画面は自分の
// 読み込みまで辿り着けず、締め切りを持っていても使う機会がない。
// 門が開かない可能性は、門で見る。
const authContext = readFileSync(
  new URL("../lib/firebase/auth-context.tsx", import.meta.url),
  "utf8",
);

check(
  "セッション復元そのものに締め切りがある",
  /setTimeout\([\s\S]{0,400}LOAD_TIMEOUT_MS\)/.test(authContext),
  "onAuthStateChanged が呼ばれなければ loading は永久に true のまま",
);

check(
  "締め切り切れは blocked として伝わる",
  authContext.includes("setBlocked("),
  "門が開かなかったことを画面が知る手段がない",
);

check(
  "門はもう一度試せる",
  authContext.includes("retryAuth"),
  "再試行のない読み込み画面は再読み込みしか出口がない",
);

// 「分からない」は「サインアウト済み」ではない。取り違えると、通信が細い
// だけのサインイン済みの学生がログイン画面に落とされる。
for (const [label, path] of [
  ["RequireAuth", "../components/require-auth.tsx"],
  ["/", "../app/page.tsx"],
]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  check(
    `${label} は開かなかった門を再試行つきで見せる`,
    source.includes("blocked") && source.includes("ScreenError"),
    "読み込み表示のまま学生のやることがない",
  );
}

// ---------------------------------------------------------------------------
console.log("\n門の二枚 — セッションと プロフィール は別々に待つ");
// ---------------------------------------------------------------------------

// 門が一枚だったころ、全画面は往復二回分を直列に待っていた。uid が分かった時点で
// 画面は自分のデータを取りに行けるのに、名前を出すためだけの users/{uid} が
// 読み終わるまで mount すらしなかった。だから待ちを二つに割った。
// 割ったものは、くっつけ直されやすい。
check(
  "セッションとプロフィールの待ちが別々に出ている",
  authContext.includes("sessionLoading") && authContext.includes("profileLoading"),
  "一つに戻すと、画面はまた往復二回を直列に待つ",
);

const requireAuth = readFileSync(
  new URL("../components/require-auth.tsx", import.meta.url),
  "utf8",
);

check(
  "RequireAuth が既定で待つのはセッションだけ",
  /waitForProfile = false/.test(requireAuth) &&
    /if \(sessionLoading \|\| !user\) return <AuthSplash/.test(requireAuth),
  "既定でプロフィールを待つと、割った意味が消える",
);

// 逆側。オンボーディングのチップは保存済みプロフィールを useState の初期値から
// 読む。初期値は一度しか読まれないので、プロフィールが届く前に描くと、答えを
// 変えに来た学生に既定値が出て、保存でそれが上書きされる。速さより保存が優先。
const onboardingLayout = readFileSync(
  new URL("../app/onboarding/layout.tsx", import.meta.url),
  "utf8",
);

check(
  "オンボーディングはプロフィールを待ってから描く",
  onboardingLayout.includes("waitForProfile"),
  "前回の答えが既定値に置き換わり、保存で消える",
);

// プロフィールが読めなくても画面は動く。動くからこそ、黙って劣化する。
const mainLayout = readFileSync(
  new URL("../app/(main)/layout.tsx", import.meta.url),
  "utf8",
);

check(
  "プロフィールの失敗はタブの中でも見える",
  mainLayout.includes("profileError") && mainLayout.includes("retryAuth"),
  "名前もプロンプトの学年も欠けたまま、理由がどこにも出ない",
);

// 先読みは受け渡しであって、キャッシュではない。消さずに残すと、再試行が
// さっき失敗したのと同じ promise を受け取って、同じ失敗を返す。
const useLoadable = readFileSync(
  new URL("../lib/use-loadable.ts", import.meta.url),
  "utf8",
);

check(
  "先読みは一度きり(受け取ったら消える)",
  /warmed\.delete\(key\)/.test(useLoadable),
  "再試行が同じ結果を受け取り、押しても何も変わらない",
);

console.log(
  failures === 0 ? "\n✅ すべて通りました\n" : `\n❌ ${failures} 件失敗しました\n`,
);
process.exit(failures === 0 ? 0 : 1);
