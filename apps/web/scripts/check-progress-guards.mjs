/**
 * Offline checks for the 壁打ち進捗レール.
 *
 * The rail works by having the model append machine-readable markers to its
 * replies, which the client strips before anything is shown or saved. That
 * design has exactly one way to fail badly, and it is not the rail filling
 * wrong: it is 「[progress:situation]」 appearing on screen, in a conversation
 * whose whole premise is that the student is talking to somebody rather than
 * operating software. One leaked marker undoes more than a missing rail ever
 * would.
 *
 * So the property this file exists to defend is the negative one: **no prefix
 * of any reply, at any point while it streams, renders a marker or any part of
 * one.** The streaming case is the dangerous one — a finished reply is easy to
 * clean, and the screen shows every intermediate state on the way there.
 *
 *   npm run check:progress
 */
import {
  PROGRESS_PROTOCOL,
  PROGRESS_STEPS,
  mergeProgress,
  progressComplete,
  readProgress,
  stripProgressMarkers,
  toProgress,
} from "../prompts/progress.ts";
import { buildChatSystemBlocks, buildChatSystemPrompt } from "../prompts/modes/index.ts";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name, actual, expected) {
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`,
  );
}

/** Anything that would give the mechanism away if it reached the screen. */
function leaks(rendered) {
  return (
    /progress/i.test(rendered) ||
    rendered.includes("[") ||
    rendered.includes("］") ||
    rendered.includes("［") ||
    rendered.includes("]")
  );
}

const BODY =
  "副キャプテンとして声をかけ続けていたんですね。\n" +
  "その練習で、最初に自分から動いたのはどの場面でしたか?";

// ---------------------------------------------------------------------------
console.log("\n剥がし — 届いた形が何であれ、本文だけが残る");
// ---------------------------------------------------------------------------

eq(
  "素直な形",
  readProgress(`${BODY}\n[progress:situation][progress:task]`).steps,
  ["situation", "task"],
);
eq("本文は無傷", readProgress(`${BODY}\n[progress:situation]`).text, BODY);

// 日本語で書いているモデルは全角に転ぶ。読めない形で届いたマーカーは、
// そのまま学生が読むマーカーになる。
eq(
  "全角の括弧とコロン",
  readProgress(`${BODY}\n［progress：action］`).steps,
  ["action"],
);
eq("空白まじり", readProgress(`${BODY}\n[ progress : result ]`).steps, ["result"]);
eq("大文字", readProgress(`${BODY}\n[Progress:LEARNING]`).steps, ["learning"]);
eq(
  "本文の途中に混ざっても落とす",
  readProgress(`前半[progress:situation]後半`).text,
  "前半後半",
);
eq("重複は一度だけ", readProgress("[progress:task][progress:task]").steps, ["task"]);
eq("知らない項目は捨てる", readProgress("[progress:motivation]").steps, []);
eq("マーカーが無い返答は素通り", readProgress(BODY).text, BODY);
eq("マーカーが無ければ進捗も無い", readProgress(BODY).steps, []);

// ---------------------------------------------------------------------------
console.log("\nストリーミング — 途中経過も含めて一度も見えない");
// ---------------------------------------------------------------------------

// 実際に届く形。5つ全部を並べ直す回が、いちばん長く「途中」を晒す。
const FULL =
  `${BODY}\n` +
  PROGRESS_STEPS.map((s) => `[progress:${s.id}]`).join("\n");

let firstLeak = null;
for (let i = 1; i <= FULL.length; i += 1) {
  const rendered = stripProgressMarkers(FULL.slice(0, i));
  if (leaks(rendered) && firstLeak === null) {
    firstLeak = { i, rendered: rendered.slice(-40) };
  }
}
check(
  `全${FULL.length}文字ぶんの途中経過に一度も漏れない`,
  firstLeak === null,
  firstLeak && `${firstLeak.i}文字目: …${firstLeak.rendered}`,
);

check(
  "本文が出ている途中は本文が読める",
  stripProgressMarkers(FULL.slice(0, 20)) === FULL.slice(0, 20),
  stripProgressMarkers(FULL.slice(0, 20)),
);
eq("最後まで来たら本文だけが残る", stripProgressMarkers(FULL), BODY);

// 一文字ずつではなくチャンク単位でも同じこと。境界がどこに落ちても変わらない。
let chunkLeak = null;
for (const size of [3, 7, 11, 23]) {
  let acc = "";
  for (let i = 0; i < FULL.length; i += size) {
    acc += FULL.slice(i, i + size);
    if (leaks(stripProgressMarkers(acc)) && chunkLeak === null) {
      chunkLeak = `${size}文字刻みの${i}文字目`;
    }
  }
}
check("チャンク境界がどこでも漏れない", chunkLeak === null, chunkLeak ?? "");

// マーカーだけの返答は Firestore の text.size() > 0 に落ちる。画面には
// 「返答を受け取れませんでした」が出るべきで、空の吹き出しであってはならない。
eq("マーカーしかない返答は空になる", readProgress("[progress:situation]").text, "");

// ---------------------------------------------------------------------------
console.log("\n併合 — レールは後戻りしない");
// ---------------------------------------------------------------------------

eq("足される", mergeProgress(["situation"], ["task"]), ["situation", "task"]);
eq(
  "前回のぶんを言い忘れた回でも減らない",
  mergeProgress(["situation", "task"], ["task"]),
  ["situation", "task"],
);
eq("何も報告が無い回でも減らない", mergeProgress(["situation"], []), ["situation"]);
eq(
  "並びは報告順ではなく 状況→課題→行動→結果→学び",
  mergeProgress([], ["learning", "situation", "action"]),
  ["situation", "action", "learning"],
);
check("5つ揃えば完成", progressComplete(PROGRESS_STEPS.map((s) => s.id)));
check("4つでは完成しない", !progressComplete(["situation", "task", "action", "result"]));

// ---------------------------------------------------------------------------
console.log("\nFirestore から戻ってきた値 — 何が入っていても壊れない");
// ---------------------------------------------------------------------------

eq("フィールドが無い(レール以前のセッション)", toProgress(undefined), []);
eq("配列でない", toProgress("situation"), []);
eq("知らない値は落ちる", toProgress(["situation", "nope", 7, null]), ["situation"]);
eq("並びは正規化される", toProgress(["learning", "situation"]), ["situation", "learning"]);

// ---------------------------------------------------------------------------
console.log("\nプロンプト — 規約は共有され、キャッシュされる側に載っている");
// ---------------------------------------------------------------------------

const blocks = buildChatSystemBlocks({ profile: null, mode: "counselor" });
check("規約はシステムプロンプトに入っている", blocks[0].text.includes(PROGRESS_PROTOCOL));
check(
  "学生ごとに変わらないブロックに載っている(コホート全体でキャッシュが効く)",
  blocks[0].cache_control?.type === "ephemeral" && !blocks[1].text.includes("progress:"),
);
check(
  "トーンが違っても規約は同じ",
  buildChatSystemBlocks({ profile: null, mode: "karakuchi" })[0].text.includes(
    PROGRESS_PROTOCOL,
  ),
);
for (const step of PROGRESS_STEPS) {
  check(
    `${step.label} の書式がプロンプトに載っている`,
    PROGRESS_PROTOCOL.includes(`[progress:${step.id}]`) &&
      PROGRESS_PROTOCOL.includes(step.label),
  );
}
check(
  "本文でマーカーに触れるなと書いてある",
  PROGRESS_PROTOCOL.includes("本文の中に混ぜない"),
  PROGRESS_PROTOCOL.slice(0, 60),
);
check(
  "ルール9(プレーン日本語)との関係が明示されている",
  buildChatSystemPrompt({ profile: null, mode: "counselor" }).includes("ルール9"),
);

console.log(
  failures === 0 ? "\n✅ すべて通りました\n" : `\n❌ ${failures} 件失敗しました\n`,
);
process.exit(failures === 0 ? 0 : 1);
