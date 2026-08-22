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
  FACTS_MAX,
  isWorksheetEmpty,
  mergeWorksheet,
  parseWorksheet,
  toWorksheet,
  worksheetPrompt,
  worksheetProgress,
  WORKSHEET_PROTOCOL,
} from "../prompts/worksheet.ts";
import {
  buildChatSystemBlocks,
  buildChatSystemPrompt,
  buildOpeningInstruction,
  FOCUS_PROTOCOL,
} from "../prompts/modes/index.ts";

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
facts: 週4回のシフト / 2年間
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

// facts だけが足し算。20往復の検証で、書き直しのたびに数字が薄れていくのを
// 見たあとに足した欄なので、「書き直されない」ことがそのまま性質になっている。
eq("具体は前の回のものが残る", first.facts, ["週4回のシフト", "2年間"]);
const grown = mergeWorksheet(
  first,
  parseWorksheet("[sheet]\nepisode: 居酒屋のホールでの2年間\nfacts: 提供時間が半分に\n[/sheet]"),
);
eq("新しい具体は足される", grown.facts, ["週4回のシフト", "2年間", "提供時間が半分に"]);
eq(
  "同じ具体を二度は持たない",
  mergeWorksheet(
    grown,
    parseWorksheet("[sheet]\nepisode: 居酒屋のホールでの2年間\nfacts: 週4回のシフト / 新しい話\n[/sheet]"),
  ).facts,
  ["週4回のシフト", "2年間", "提供時間が半分に", "新しい話"],
);
eq(
  "書かなかった回でも消えない",
  mergeWorksheet(grown, parseWorksheet("[sheet]\nepisode: 居酒屋のホールでの2年間\nfacts:\n[/sheet]")).facts,
  grown.facts,
);
check(
  "上限を超えては持たない",
  mergeWorksheet(
    EMPTY_WORKSHEET,
    parseWorksheet(
      `[sheet]\nfacts: ${Array.from({ length: 20 }, (_, i) => `事実${i}`).join(" / ")}\n[/sheet]`,
    ),
  ).facts.length === FACTS_MAX,
);

const switched = mergeWorksheet(
  second,
  parseWorksheet("[sheet]\nepisode: 高校のサッカー部\nsituation: 高校3年、副キャプテン\n[/sheet]"),
);
eq("エピソードが変われば前の行動は残らない", switched.action, "");
eq("エピソードが変われば新しい状況が入る", switched.situation, "高校3年、副キャプテン");
eq("エピソードが変われば具体も入れ替わる", switched.facts, []);
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
check("深掘りの規律もキャッシュされる側", blocks[0].text.includes(FOCUS_PROTOCOL));
check(
  "脱線の置き場所が pending だと書いてある",
  FOCUS_PROTOCOL.includes("pending に一行で控える"),
);
check(
  "回収の合図が書いてある",
  FOCUS_PROTOCOL.includes("5つの節が埋まったら") && FOCUS_PROTOCOL.includes("先ほど"),
);
check(
  "動機の一段が書いてある",
  FOCUS_PROTOCOL.includes("なぜそうしようと思ったのですか"),
);
check(
  "探索から始まる道が書いてある",
  FOCUS_PROTOCOL.includes("phase が「探索」のあいだ") &&
    FOCUS_PROTOCOL.includes("「深掘り」に切り替える"),
);

// 最初の一言は、話したいことが決まっていない学生にも入口がある形で出る。
eq(
  "始まりの二択がそのまま読める",
  parseChoices(buildOpeningInstruction()),
  ["話したいエピソードがある", "まだ見つかっていない"],
);
check(
  "毎回全部書けと書いてある",
  WORKSHEET_PROTOCOL.includes("毎回、全部の行を書く"),
);
// 20往復の検証(npm run verify:memory)で最初に落ちたのは数字だった。書き写せと
// 言うだけでは足りず、何が落ちるのかを名指しする必要があった。
check(
  "書き写せと書いてある(要約し直させない)",
  WORKSHEET_PROTOCOL.includes("一字一句そのまま書き写す"),
);
check(
  "落ちやすいものが名指しされている",
  WORKSHEET_PROTOCOL.includes("数字・人数・時間・固有名詞"),
);
check(
  "facts だけは新しいぶんだけと書いてある",
  WORKSHEET_PROTOCOL.includes("その回で新しく出たものだけを書く"),
);
check(
  "書いてあることは答えると書いてある",
  WORKSHEET_PROTOCOL.includes("書いてあるとおりに答える"),
);
check(
  "シートを見て答えたことを学生に言わない",
  WORKSHEET_PROTOCOL.includes("という言葉を出さない") &&
    WORKSHEET_PROTOCOL.includes("○「副キャプテンでしたね」"),
);
check(
  "同封されるシートは記憶だと名乗っている",
  worksheetPrompt(second).includes("この壁打ちの記憶"),
);
// 同じ指示がシステムプロンプトにもある。二重なのは意図的で、20往復の検証では
// 遠いほうだけでは足りなかった——聞き返しに答えるかどうかを決めているのは、
// 問いのすぐ隣にあるこの一行のほう。
check(
  "聞き返しに答えろと、問いの隣でも言っている",
  worksheetPrompt(second).includes("書いてあるとおりに答えてください"),
);
check(
  "空のシートでも何か言う",
  worksheetPrompt(EMPTY_WORKSHEET).includes("まだ何も書かれていません"),
);

console.log(
  failures === 0 ? "\n✅ すべて通過\n" : `\n❌ ${failures}件 失敗\n`,
);
process.exit(failures === 0 ? 0 : 1);
