/**
 * エピソードシート — 会話が長くなっても核心が消えないようにするための、一枚の紙。
 *
 * βフィードバック 8/18: 「同じことを二度聞かれる」「20往復くらいすると最初の話を
 * 忘れている」。原因はスライディングウィンドウで、それ自体は正しい仕組みだった。
 * 直近16往復を送るなら17往復目には最初の1往復が落ちる。落ちた先に何も残っていな
 * かったのが問題で、窓を広げてもその境界が後ろにずれるだけになる。
 *
 * だからこの一枚を、窓とは別に持ち回る。AIが毎ターン書き直し、サーバーが
 * users/{uid}/sessions/{id}.worksheet に保存し、次のターンの依頼に必ず同封する。
 * 履歴から消えた話でも、ここに書いてあるものは「聞いた話」として扱われる。
 *
 * ── なぜ進捗マーカーを置き換えたのか ──
 * 5つの節が埋まったかどうかを報告させる仕組み([progress:situation])は、すでに毎回
 * 返答の末尾に付いていた。それを「埋まったか」ではなく「何が埋まったか」に広げた
 * のがこのシートで、進捗レールはシートの各欄が埋まっているかから導かれる。二つの
 * 仕組みを並走させると、埋まったと言っているのに中身が無い、あるいはその逆が起き
 * る——同じことを二度言わせて食い違わせる理由がない。
 *
 * ── 未回収の話題メモ ──
 * pending は脱線の置き場所。学生が今のエピソードの途中で別の話を持ち出したとき、
 * AIはそちらへ飛ばずにここへ控え、STARが揃ってから「先ほどの◯◯についても」と
 * 回収する。飛ばないことと忘れないことを両立させる場所が要る、というだけの欄。
 */

import { PROGRESS_STEPS, type ProgressStep } from "./progress";
import { blockOf, fieldsOf } from "./tags";

/**
 * どの段階にいるか。
 *
 * 「話したいエピソードがまだ見つかっていない」学生と、一つの経験を掘っている学生
 * では、次に来るべき問いが違う。深掘りの規律(今のエピソードから離れない)を探索中
 * にも当てると、まだ何も決まっていない相手に一つの話題を強制することになる。
 */
export type WorksheetPhase = "探索" | "深掘り";

export type Worksheet = {
  phase: WorksheetPhase;
  /** 今扱っている経験。一行の見出し。 */
  episode: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  learning: string;
  /**
   * なぜそうしようと思ったのか。
   *
   * STARの外に一欄を切ってあるのは、ここが最も埋まりにくく、最も自分史の役に立つ
   * ところだから。行動と結果だけのガクチカは誰の話でもありうる。
   */
  motive: string;
  /** 未回収の話題メモ。 */
  pending: string[];
};

/** The five 節 the rail draws, in the order it draws them. */
const STAR_FIELDS = PROGRESS_STEPS.map((s) => s.id);

/** Every text field, in the order the sheet is written and read. */
const TEXT_FIELDS = ["episode", ...STAR_FIELDS, "motive"] as const;

type TextField = (typeof TEXT_FIELDS)[number];

export const EMPTY_WORKSHEET: Worksheet = {
  phase: "探索",
  episode: "",
  situation: "",
  task: "",
  action: "",
  result: "",
  learning: "",
  motive: "",
  pending: [],
};

/**
 * How long one field may be.
 *
 * The sheet is a working note, not a second transcript: a 状況 that runs longer
 * than this is the model transcribing the conversation into the thing that is
 * supposed to survive it, and it travels in every request from then on.
 */
export const FIELD_MAX = 400;

/** How many loose ends are worth carrying. */
export const PENDING_MAX = 6;

/** 未回収メモの区切り。全角スラッシュも読む。 */
const PENDING_SPLIT = /[/／]/;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, FIELD_MAX);
}

function toPhase(value: string | undefined, fallback: WorksheetPhase): WorksheetPhase {
  if (!value) return fallback;
  // 「探索」「探索中」「まだ探している」——どれも同じことを言っている。
  return /探/.test(value) ? "探索" : /深|掘/.test(value) ? "深掘り" : fallback;
}

function toPending(value: string): string[] {
  return value
    .split(PENDING_SPLIT)
    .map((item) => clean(item))
    // 「なし」 is the model answering the question rather than leaving a note.
    .filter((item) => item.length > 0 && item !== "なし" && item !== "-")
    .slice(0, PENDING_MAX);
}

/**
 * The sheet a reply carries, or null when it carried none.
 *
 * Null and "an empty sheet" are different answers and the caller depends on the
 * difference: a turn that wrote no block leaves what is stored alone, while a
 * turn that wrote a block with an empty 状況 is saying something about 状況.
 */
export function parseWorksheet(reply: string): Partial<Worksheet> | null {
  const body = blockOf(reply, "sheet");
  if (body === null) return null;

  const fields = fieldsOf(body);
  const sheet: Partial<Worksheet> = {};

  const phase = fields.get("phase");
  if (phase !== undefined) sheet.phase = toPhase(phase, "深掘り");

  for (const field of TEXT_FIELDS) {
    const value = fields.get(field);
    if (value !== undefined) sheet[field] = clean(value);
  }

  const pending = fields.get("pending");
  if (pending !== undefined) sheet.pending = toPending(pending);

  return sheet;
}

/**
 * 前のシートに、今回の更新を重ねる。
 *
 * 二つの規則があり、分けているのはエピソードが変わったかどうか。
 *
 * - 同じエピソードのあいだ: **空欄は消さない**。プロトコルは毎回シート全文を
 *   書き直せと言っているし、モデルはだいたいそうする。だが「だいたい」で埋まった
 *   欄が消えると、学生が見ている進捗レールが後退する——それは、書いたものをアプリ
 *   が失ったという意味に読める。書かなかった回は「変わっていない」と読む。
 * - エピソードが変わったとき: **今回の内容がすべて**。前の経験の行動と結果を次の
 *   経験の欄に残したままにすると、二つの話が一枚に混ざる。混ざったシートは毎ター
 *   ン同封されるので、間違いがその場で消えずに会話の残り全部に効いてしまう。
 *
 * エピソード行の言い回しが揺れただけで作り直しになる可能性は残っている。ただしその
 * 場合も、モデルは同じ回に全欄を書き直しているので、置き換わる先は正しい内容になる。
 */
export function mergeWorksheet(
  previous: Worksheet,
  update: Partial<Worksheet> | null,
): Worksheet {
  if (!update) return previous;

  const changed =
    typeof update.episode === "string" &&
    update.episode.length > 0 &&
    previous.episode.length > 0 &&
    update.episode !== previous.episode;

  const base = changed ? EMPTY_WORKSHEET : previous;
  const merged: Worksheet = { ...base, phase: update.phase ?? base.phase };

  for (const field of TEXT_FIELDS) {
    const value = update[field];
    // On the same episode an empty string is silence, not an erasure. On a new
    // one there is nothing to preserve, and `base` is already empty.
    merged[field] = value === undefined || (value === "" && !changed) ? base[field] : value;
  }

  merged.pending = update.pending ?? base.pending;
  return merged;
}

/** Firestore hands back whatever is in the document; keep only a real sheet. */
export function toWorksheet(value: unknown): Worksheet {
  if (!value || typeof value !== "object") return EMPTY_WORKSHEET;
  const raw = value as Record<string, unknown>;

  const sheet: Worksheet = { ...EMPTY_WORKSHEET };
  sheet.phase = toPhase(typeof raw.phase === "string" ? raw.phase : undefined, "探索");
  for (const field of TEXT_FIELDS) {
    if (typeof raw[field] === "string") sheet[field] = clean(raw[field] as string);
  }
  if (Array.isArray(raw.pending)) {
    sheet.pending = raw.pending
      .filter((item): item is string => typeof item === "string")
      .map(clean)
      .filter((item) => item.length > 0)
      .slice(0, PENDING_MAX);
  }
  return sheet;
}

/** Nothing has been written on it yet. */
export function isWorksheetEmpty(sheet: Worksheet): boolean {
  return (
    TEXT_FIELDS.every((field) => sheet[field].length === 0) && sheet.pending.length === 0
  );
}

/**
 * 進捗レールが描くもの——シートのどの節が埋まっているか。
 *
 * 別に数えるのではなく導く。マーカーとシートを両方書かせていた頃は、埋まったと
 * 報告された節と中身のある欄が食い違いうるという、誰にも直せない形の不整合が
 * 残っていた。一枚から導けば、レールが指しているものは常に「シートを開けば読める
 * もの」になる——タップして中を見られるようになった今、それは実際に確かめられる。
 */
export function worksheetProgress(sheet: Worksheet): ProgressStep[] {
  return STAR_FIELDS.filter((id) => sheet[id].length > 0);
}

/**
 * The sheet as the model is given it back.
 *
 * Sent with every turn, in the request rather than the system prompt — see
 * toAnthropicMessages: the system prompt and the transcript in front of it are
 * cached, and a block that changes every turn would invalidate both if it sat
 * ahead of them.
 */
export function worksheetPrompt(sheet: Worksheet): string {
  if (isWorksheetEmpty(sheet)) {
    return `【エピソードシート】
まだ何も書かれていません。話を聞きながら埋めていってください。`;
  }

  const lines = [`phase: ${sheet.phase}`];
  for (const field of TEXT_FIELDS) {
    if (sheet[field]) lines.push(`${field}: ${sheet[field]}`);
  }
  if (sheet.pending.length > 0) {
    lines.push(`pending: ${sheet.pending.join(" / ")}`);
  }

  return `【エピソードシート】(これまでの整理。学生も画面で見ていて、書き直すことがあります)
${lines.join("\n")}

これがこの壁打ちの記憶です。上の履歴から消えている話でも、ここに書いてあることは
すでに聞いた話として扱ってください。同じことをもう一度聞かないでください。
学生が書き直した欄があれば、そちらが正しいものとして受け取ってください。`;
}

/**
 * The instruction that produces the block.
 *
 * Written from the field list so what the model is told and what the parser
 * reads cannot drift apart. It joins the shared, cached half of the system
 * prompt — the protocol is the same for every student on every tone.
 */
export const WORKSHEET_PROTOCOL = `【エピソードシート】(システム用・学生には表示されない)
返答の本文を書き終えたあと、改行して、いまの整理状況を次の形式で必ず出力して
ください。

[sheet]
phase: 探索 または 深掘り
episode: いま扱っている経験。一行の見出し
situation: いつ・どこで・どんな場面だったか
task: そこで何が問題だったか、何を目指したか
action: 本人が具体的に何をしたか
result: その行動で何がどうなったか
learning: その経験から何を得たか、どんな価値観が出ているか
motive: なぜそうしようと思ったのか。本人の動機
pending: まだ聞けていない話題。複数あれば / で区切る
[/sheet]

- **毎回、全部の行を書く。** 前の回に書いた内容は、変わっていなければそのまま
  書き写す。このシートが会話の記憶であり、書かなかった行は次のターンのあなたに
  届きません。
- 学生が言っていないことは書かない。埋まっていない行は、行だけ残して空にする。
  推測で埋めたものが、次のターンでは「聞いた話」として扱われます。
- 抽象語のままの欄は埋めない。「頑張った」「コミュニケーション能力」で終わって
  いるものは、まだ語られていません。
- 一行一項目。値の中で改行しない。長くても100字程度に要約する。
- 別のエピソードに移るときだけ、episode を書き換える。同じ経験の話が続いている
  あいだは、言い回しも変えずに同じ一行を書き写してください。
- pending には、学生が持ち出したが今は掘らないと決めた話題を書く。回収したら
  その行から消す。
- タグと中身は必ず本文より後、最後に置く。本文の中に混ぜない。
- 本文では、シートにも項目名(状況・課題・行動・結果・学び)にも言及しない。学生は
  進捗を画面で見ていますが、それを話題にするのはあなたの仕事ではありません。
  問いを重ねてください。
- この規約はルール9(プレーンな日本語の文章のみ)の例外です。本文はこれまでどおり、
  記号も見出しも使わない日本語で書いてください。`;
