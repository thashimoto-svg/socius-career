/**
 * STAR extraction — the step that turns a 壁打ち into a 自分史 card.
 *
 * 「カードの言葉はすべて学生本人の発話から抽出(AIの要約文体にしない)」
 * (docs/specs/ui-notes.md). The model here is a structurer, not a writer: it
 * decides which of the student's sentences belong in which slot, and is told
 * in as many ways as necessary not to improve them on the way.
 */

/**
 * The tag vocabulary. Closed on purpose: 自分史 cards are meant to be scannable
 * at a glance, which stops working the moment every card invents its own label.
 * The same list drives the response schema and the server-side check.
 */
export const EPISODE_TAGS = [
  "部活動",
  "サークル",
  "アルバイト",
  "研究・ゼミ",
  "課外活動",
  "その他",
] as const;

export type EpisodeTag = (typeof EPISODE_TAGS)[number];

export const EXTRACTION_SYSTEM_PROMPT = `あなたは対話ログから、就活生のエピソードを STAR 形式に構造化する編集者です。
文章を書く人ではありません。学生が実際に話した言葉を、正しい枠に入れ直すだけの役割です。

【絶対に守るルール】
1. 学生(role: user)の発話だけを材料にする。AI(role: ai)の問いかけや言い回しは使わない。
2. 学生の言葉づかいをそのまま残す。話し言葉を書き言葉に直さない。
   「〜だと思います」「〜してました」のような語尾も、本人が言ったなら残す。
3. 事実を足さない。数字・時期・結果を推測で補わない。
   語られていない項目は、その部分だけ空文字にする。捏造するくらいなら空にする。
4. 「素晴らしい経験です」のような評価や励ましを書かない。
5. learn(学び)も学生自身が言葉にしたものだけを使う。
   学生が学びを語っていなければ空文字にする。あなたが教訓を作らない。
6. title は学生の言葉を使った25字以内の一文。体言止めでよい。
7. tag は次から最も近いものを1つだけ選ぶ。新しい言葉を作らない:
   ${EPISODE_TAGS.join(" / ")}
8. emotion は学生が語った感情の変化を「悔しさ → 手応え」のように「A → B」の形で書く。
   変化が語られていなければ空文字。感情そのものが語られていなければ空文字。`;

/** One line of the transcript as the extractor sees it. */
export type TranscriptLine = { role: "user" | "ai"; text: string };

export function buildExtractionPrompt(transcript: TranscriptLine[]): string {
  const log = transcript
    .map((m) => `${m.role === "user" ? "学生" : "AI"}: ${m.text}`)
    .join("\n");

  return `次の壁打ちのログから、エピソードを1件だけ抽出してください。
複数の話題がある場合は、学生が最も具体的に語った1件を選びます。

----- ログ ここから -----
${log}
----- ログ ここまで -----`;
}

/**
 * Response schema for the extraction call. Plain strings rather than the SDK's
 * `Type` enum so this package stays independent of @google/genai.
 */
export const EPISODE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    tag: { type: "STRING", enum: EPISODE_TAGS },
    emotion: { type: "STRING" },
    star: {
      type: "OBJECT",
      properties: {
        S: { type: "STRING", description: "状況 — いつ、どんな場面だったか" },
        T: {
          type: "STRING",
          description: "課題 — 何を目指した / 求められたか",
        },
        A: { type: "STRING", description: "行動 — 実際に何をしたか" },
        R: { type: "STRING", description: "結果 — 何が起きたか" },
      },
      required: ["S", "T", "A", "R"],
    },
    learn: { type: "STRING" },
  },
  required: ["title", "tag", "emotion", "star", "learn"],
} as const;

export type ExtractedEpisode = {
  title: string;
  tag: string;
  emotion: string;
  star: { S: string; T: string; A: string; R: string };
  learn: string;
};
