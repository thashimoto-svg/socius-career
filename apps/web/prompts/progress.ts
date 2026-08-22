/**
 * 「あと何を話せば終わりなのか」に答えるための5つの節。
 *
 * βフィードバック: 「壁打ちの終わりが見えず途中で離脱してしまう」。壁打ちには
 * 完成条件があるのに、それを知っているのはプロンプトだけで、学生の側からは
 * 問いが延々と続く画面にしか見えていなかった。ガクチカとして成立するのは
 * 状況・課題・行動・結果・学びが揃ったときで、それはこの5つを画面に出せば
 * そのまま進捗になる。
 *
 * ここに残っているのは語彙だけになった。「どれが埋まったか」を返答の末尾の
 * マーカー([progress:situation])で報告させる仕組みは、エピソードシート
 * (./worksheet)に吸収されている——同じ5つを、埋まったかどうかではなく中身ごと
 * 書かせるようになったので、レールはシートのどの欄に文字があるかから導かれる。
 * 判定材料が一番揃っているのはその会話を書いている当人だ、という理由は変わらない。
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

/** 並びが報告順に左右されないよう、常にこの順に整える。 */
function inCanonicalOrder(steps: readonly ProgressStep[]): ProgressStep[] {
  const all = new Set(steps);
  return PROGRESS_STEPS.map((s) => s.id).filter((id) => all.has(id));
}

/** Whether the episode is whole — all five, in any order. */
export function progressComplete(steps: readonly ProgressStep[]): boolean {
  return PROGRESS_STEPS.every((s) => steps.includes(s.id));
}

/** Firestore hands back whatever is in the document; keep only real ids. */
export function toProgress(value: unknown): ProgressStep[] {
  if (!Array.isArray(value)) return [];
  return inCanonicalOrder(value.filter(isProgressStep));
}
