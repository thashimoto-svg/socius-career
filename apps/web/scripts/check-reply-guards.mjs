/**
 * Offline checks for what a reply carries besides the reply.
 *
 * The 壁打ち works by having the model append machine-readable blocks to its
 * answers — the エピソードシート, and sometimes a list of choices — which the
 * client strips before anything is shown or saved. That design has exactly one
 * way to fail badly, and it is not the sheet coming out wrong: it is
 * 「[sheet]」 appearing on screen, in a conversation whose whole premise is that
 * the student is talking to somebody rather than operating software. One leaked
 * tag undoes more than a missing sheet ever would.
 *
 * So the property this file exists to defend is the negative one: **no prefix
 * of any reply, at any point while it streams, renders a tag or any part of
 * one.** The streaming case is the dangerous one — a finished reply is easy to
 * clean, and the screen shows every intermediate state on the way there.
 *
 * The rest of the file defends the sheet's own arithmetic, which has a quieter
 * failure mode: a merge rule that drops a field silently un-fills the rail the
 * student is watching, and a rail that retreats reads as the app losing their
 * work.
 *
 *   npm run check:reply
 */
import { CHOICES_PROTOCOL, parseChoices } from "../prompts/choices.ts";
import { progressComplete, PROGRESS_STEPS, toProgress } from "../prompts/progress.ts";
import { readReply, stripReply } from "../prompts/reply.ts";
import {
  EMPTY_WORKSHEET,
  isWorksheetEmpty,
  mergeWorksheet,
  parseWorksheet,
  toWorksheet,
  worksheetPrompt,
  worksheetProgress,
  WORKSHEET_PROTOCOL,
} from "../prompts/worksheet.ts";
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
    /sheet|choices|phase:|episode:|pending:/i.test(rendered) ||
    rendered.includes("[") ||
    rendered.includes("］") ||
    rendered.includes("［") ||
    rendered.includes("]")
  );
}

const BODY =
  "そのとき、いちばん困っていたのはどんなことでしたか。もう少しだけ、その場面を教えてください。";

const SHEET_BLOCK = `[sheet]
phase: 深掘り
episode: 居酒屋のホールでの2年間
situation: 大学2年、居酒屋のホールで週4回
task: 忙しい時間帯に注文が詰まり、クレームが増えていた
action:
result:
learning:
motive:
pending: 高校の部活の話
[/sheet]`;

const CHOICES_BLOCK = "[choices] 部活の話 | アルバイトの話 | 授業の話 [/choices]";

const FULL = `${BODY}\n${CHOICES_BLOCK}\n${SHEET_BLOCK}`;

// ---------------------------------------------------------------------------
console.log("\n【本文とタグを分ける】");

eq("本文は無傷", readReply(FULL).text, BODY);
eq("タグが無い返答は素通り", readReply(BODY).text, BODY);
eq("タグしかない返答は空になる", readReply(SHEET_BLOCK).text, "");
eq("選択肢が読める", readReply(FULL).choices, ["部活の話", "アルバイトの話", "授業の話"]);
eq("シートが読める", readReply(FULL).sheet.episode, "居酒屋のホールでの2年間");
eq("ブロックが無ければ更新も無い", readReply(BODY).sheet, null);
eq("ブロックが無ければ選択肢も無い", readReply(BODY).choices, []);

eq(
  "タグの前に本文があれば、そこで切る",
  stripReply(`前半${SHEET_BLOCK}`),
  "前半",
);
eq(
  "閉じタグだけが来ても漏らさない",
  stripReply(`${BODY}\n[/sheet]`),
  BODY,
);
eq(
  "全角の括弧も読む",
  stripReply(`${BODY}\n［sheet］\nphase: 探索\n［/sheet］`),
  BODY,
);

// ---------------------------------------------------------------------------
console.log("\n【流れている途中でも漏らさない】");

let leaked = null;
for (let i = 1; i <= FULL.length; i += 1) {
  const rendered = stripReply(FULL.slice(0, i));
  if (leaks(rendered) && leaked === null) {
    leaked = { i, rendered: rendered.slice(-40) };
  }
}
check(
  "どの途中経過を描いてもタグは出ない",
  leaked === null,
  leaked && `${leaked.i}文字目: …${leaked.rendered}`,
);

check(
  "タグが始まるまでは本文がそのまま出る",
  stripReply(FULL.slice(0, 20)) === FULL.slice(0, 20),
  stripReply(FULL.slice(0, 20)),
);
eq("最後まで来たら本文だけが残る", stripReply(FULL), BODY);

// 一文字ずつ届く場合。実際の配信はこの粒度ではないが、境界は全部ここに出る。
let chunkLeak = null;
let acc = "";
for (const ch of FULL) {
  acc += ch;
  if (leaks(stripReply(acc)) && chunkLeak === null) chunkLeak = acc.slice(-30);
}
check("一文字ずつ届いても漏らさない", chunkLeak === null, chunkLeak ?? "");

// ---------------------------------------------------------------------------
console.log("\n【シートを重ねる】");

const first = mergeWorksheet(EMPTY_WORKSHEET, parseWorksheet(FULL));
eq("空欄は空のまま", first.action, "");
eq("phase が読める", first.phase, "深掘り");
eq("未回収メモが読める", first.pending, ["高校の部活の話"]);

const second = mergeWorksheet(
  first,
  parseWorksheet(`[sheet]
episode: 居酒屋のホールでの2年間
action: ドリンク担当を固定する案を出し、金曜の夜に試した
[/sheet]`),
);
eq("書かれた欄は入る", second.action, "ドリンク担当を固定する案を出し、金曜の夜に試した");
eq("書かなかった欄は消えない", second.situation, first.situation);
eq("書かなかったメモも消えない", second.pending, first.pending);

const cleared = mergeWorksheet(
  second,
  parseWorksheet("[sheet]\nepisode: 居酒屋のホールでの2年間\npending:\n[/sheet]"),
);
eq("空のpending行は「回収済み」として消す", cleared.pending, []);

const switched = mergeWorksheet(
  second,
  parseWorksheet("[sheet]\nepisode: 高校のサッカー部\nsituation: 高校3年、副キャプテン\n[/sheet]"),
);
eq("エピソードが変われば前の行動は残らない", switched.action, "");
eq("エピソードが変われば新しい状況が入る", switched.situation, "高校3年、副キャプテン");
eq("更新が無い回は何も動かない", mergeWorksheet(second, null), second);

// ---------------------------------------------------------------------------
console.log("\n【レールはシートから導かれる】");

eq("書いてある欄だけが埋まる", worksheetProgress(second), ["situation", "task", "action"]);
eq("空のシートでは何も埋まらない", worksheetProgress(EMPTY_WORKSHEET), []);
check(
  "5つ書いてあれば完成",
  progressComplete(
    worksheetProgress(
      mergeWorksheet(
        EMPTY_WORKSHEET,
        parseWorksheet(
          `[sheet]\n${PROGRESS_STEPS.map((s) => `${s.id}: ${s.label}の中身`).join("\n")}\n[/sheet]`,
        ),
      ),
    ),
  ),
);
check("空のシートは空だと分かる", isWorksheetEmpty(EMPTY_WORKSHEET));
check("何か書いてあれば空ではない", !isWorksheetEmpty(second));

// ---------------------------------------------------------------------------
console.log("\n【Firestoreから戻ってきたもの】");

eq("フィールドが無い(シート以前のセッション)", toWorksheet(undefined), EMPTY_WORKSHEET);
eq("マップでない", toWorksheet("situation"), EMPTY_WORKSHEET);
eq(
  "知らないキーは落ちる",
  toWorksheet({ episode: "部活", nope: 7, pending: ["A", 3, ""] }).pending,
  ["A"],
);
eq("進捗の並びは正規化される", toProgress(["learning", "situation"]), ["situation", "learning"]);

// ---------------------------------------------------------------------------
console.log("\n【選択肢】");

eq("2つ以上で成立", parseChoices("[choices] はい | いいえ [/choices]"), ["はい", "いいえ"]);
eq("1つだけなら出さない", parseChoices("[choices] はい [/choices]"), []);
eq("全角の縦棒も区切り", parseChoices("[choices] はい ｜ いいえ [/choices]"), ["はい", "いいえ"]);
eq("重複は一度だけ", parseChoices("[choices] はい | はい | いいえ [/choices]"), ["はい", "いいえ"]);
eq(
  "長すぎるものは選択肢ではない",
  parseChoices(`[choices] 短い | ${"あ".repeat(60)} | もう一つ [/choices]`),
  ["短い", "もう一つ"],
);
eq("閉じていないブロックは読まない", parseChoices("[choices] はい | いいえ"), []);
eq("上限4つ", parseChoices("[choices] 1 | 2 | 3 | 4 | 5 [/choices]").length, 4);

// ---------------------------------------------------------------------------
console.log("\n【プロンプトに載っている】");

const blocks = buildChatSystemBlocks({ profile: null, mode: "counselor" });
check("シートの規約はキャッシュされる側に入っている", blocks[0].text.includes(WORKSHEET_PROTOCOL));
check("選択肢の規約もキャッシュされる側", blocks[0].text.includes(CHOICES_PROTOCOL));
check(
  "シートそのものはシステムプロンプトに入れない",
  !buildChatSystemPrompt({ profile: null, mode: "counselor" }).includes("【エピソードシート】(これまでの整理"),
);
for (const step of PROGRESS_STEPS) {
  check(
    `規約が ${step.id} を要求している`,
    WORKSHEET_PROTOCOL.includes(`${step.id}:`),
    WORKSHEET_PROTOCOL.slice(0, 60),
  );
}
check("本文に混ぜるなと書いてある", WORKSHEET_PROTOCOL.includes("本文の中に混ぜない"));
check(
  "毎回全部書けと書いてある",
  WORKSHEET_PROTOCOL.includes("毎回、全部の行を書く"),
);
check(
  "同封されるシートは記憶だと名乗っている",
  worksheetPrompt(second).includes("この壁打ちの記憶"),
);
check(
  "空のシートでも何か言う",
  worksheetPrompt(EMPTY_WORKSHEET).includes("まだ何も書かれていません"),
);

console.log(
  failures === 0 ? "\n✅ すべて通過\n" : `\n❌ ${failures}件 失敗\n`,
);
process.exit(failures === 0 ? 0 : 1);
