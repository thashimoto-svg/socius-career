/**
 * 「あと何を話せば終わりなのか」に答えるための5つの節。
 *
 * βフィードバック: 「壁打ちの終わりが見えず途中で離脱してしまう」。壁打ちには
 * 完成条件があるのに、それを知っているのはプロンプトだけで、学生の側からは
 * 問いが延々と続く画面にしか見えていなかった。ガクチカとして成立するのは
 * 状況・課題・行動・結果・学びが揃ったときで、それはこの5つを画面に出せば
 * そのまま進捗になる。
 *
 * 判定はAI自身にさせる。返答の末尾に「もう十分に具体的になった項目」を
 * マーカーとして並べさせ、クライアントはそれを剥がして表示する。転記や
 * 別の解析呼び出しを増やさずに済み、何より判定材料が一番揃っているのは
 * その会話を書いている当人だという理由から。
 *
 * マーカーは学生に見えてはならない。この規約と、それを剥がすコードが同じ
 * ファイルに入っているのはそのためで、片方だけ書き換えると壊れる。
 */

export const PROGRESS_STEPS = [
  { id: "situation", label: "状況", asks: "いつ・どこで・どんな場面だったか" },
  { id: "task", label: "課題", asks: "そこで何が問題だったか、何を目指したか" },
  { id: "action", label: "行動", asks: "本人が具体的に何をしたか" },
  { id: "result", label: "結果", asks: "その行動で何がどうなったか" },
  { id: "learning", label: "学び", asks: "その経験から何を得たか、どんな価値観が出ているか" },
] as const;

export type ProgressStep = (typeof PROGRESS_STEPS)[number]["id"];

const STEP_IDS: readonly string[] = PROGRESS_STEPS.map((s) => s.id);

export function isProgressStep(value: unknown): value is ProgressStep {
  return typeof value === "string" && STEP_IDS.includes(value);
}

/**
 * A complete marker.
 *
 * Deliberately forgiving about the things a Japanese model gets wrong on the
 * way to the right answer — 全角の括弧とコロン, and stray spaces. A marker that
 * arrives in a shape we do not recognise is a marker the student reads, which
 * is the one failure this whole file exists to prevent.
 */
const MARKER = /[[［]\s*progress\s*[:：]\s*([a-zA-Z]+)\s*[\]］]/gi;

/**
 * A marker that has only half arrived.
 *
 * The reply is rendered while it streams, so 「[progr」 is on screen for as long
 * as the next chunk takes. Anything from an opening bracket to the end of the
 * text, made only of the characters a marker can contain before its closing
 * bracket, is treated as one — Japanese prose does not produce that shape, and
 * the model is told not to use brackets at all.
 */
const PARTIAL_MARKER = /[[［][a-zA-Z:：\s]{0,24}$/;

/** What the student sees: the reply with every marker, whole or half, removed. */
export function stripProgressMarkers(text: string): string {
  return text.replace(MARKER, "").replace(PARTIAL_MARKER, "").trimEnd();
}

/**
 * Split a finished reply into what is shown and what it reported.
 *
 * Unknown ids are dropped rather than kept: the model occasionally invents a
 * sixth step, and a rail with a segment nobody can name is worse than one that
 * fills a little slower.
 */
export function readProgress(text: string): { text: string; steps: ProgressStep[] } {
  const steps: ProgressStep[] = [];
  for (const [, id] of text.matchAll(MARKER)) {
    const lower = id.toLowerCase();
    if (isProgressStep(lower) && !steps.includes(lower)) steps.push(lower);
  }
  return { text: stripProgressMarkers(text), steps };
}

/**
 * Add what a turn reported to what the 壁打ち already had.
 *
 * A union, never a replacement, so the rail cannot go backwards. The model is
 * asked to restate the whole set every turn and mostly does, but a turn that
 * forgets one would otherwise un-fill a step the student watched fill — and a
 * progress bar that retreats is read as the app losing their work.
 */
export function mergeProgress(
  known: readonly ProgressStep[],
  found: readonly ProgressStep[],
): ProgressStep[] {
  const all = new Set<ProgressStep>([...known, ...found]);
  // Canonical order, so what is stored does not depend on the order they were
  // reported in.
  return PROGRESS_STEPS.map((s) => s.id).filter((id) => all.has(id));
}

/** Whether the episode is whole — all five, in any order. */
export function progressComplete(steps: readonly ProgressStep[]): boolean {
  return PROGRESS_STEPS.every((s) => steps.includes(s.id));
}

/** Firestore hands back whatever is in the document; keep only real ids. */
export function toProgress(value: unknown): ProgressStep[] {
  if (!Array.isArray(value)) return [];
  return mergeProgress([], value.filter(isProgressStep));
}

/**
 * The instruction that produces the markers.
 *
 * Written from PROGRESS_STEPS so the list the model is given and the list the
 * rail draws cannot drift apart. It joins the shared, cached half of the system
 * prompt — the protocol is the same for every student on every tone.
 */
export const PROGRESS_PROTOCOL = `【進捗マーカー】(システム用・学生には表示されない)
返答の本文を書き終えたあと、改行して、会話全体を通して**もう十分に具体的に
語られた**項目を、次の形式ですべて並べてください。

${PROGRESS_STEPS.map((s) => `[progress:${s.id}]  ${s.label} — ${s.asks}`).join("\n")}

- 毎回、会話全体を見直して該当するものを"すべて"書き直す。前の回で出したものも
  もう一度書く。書かなかった項目は「まだ埋まっていない」と解釈されます。
- 該当が一つもない回は、一つも書かない。
- 抽象語のままの項目は埋めない。「頑張った」「コミュニケーション能力」で
  終わっているものは、まだ語られていません。
- マーカーは必ず本文より後、最後にまとめて置く。本文の中に混ぜない。
- 本文では、マーカーにも項目名(状況・課題・行動・結果・学び)にも言及しない。
  学生はこの5つを画面で見ていますが、それを話題にするのはあなたの仕事では
  ありません。問いを重ねてください。
- この規約はルール9(プレーンな日本語の文章のみ)の唯一の例外です。本文は
  これまでどおり、記号も見出しも使わない日本語で書いてください。`;
