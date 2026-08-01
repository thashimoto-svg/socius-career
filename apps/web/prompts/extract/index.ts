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

/**
 * When it happened, in the only resolution a 自分史 needs.
 *
 * The timeline is the first thing the 自分史 shows, and a card cannot be placed
 * on it without this. Ordered, and closed for the same reason the tags are:
 * a scale invents itself into uselessness the moment 「大学2年の秋」 and
 * 「2年生のとき」 become different rungs.
 *
 * 「不明」 is a real answer, not a failure. Students talk about what happened
 * long before they mention which year it was, and a card placed on a guess is
 * worse than one waiting to be placed.
 */
export const EPISODE_PERIODS = [
  "高校以前",
  "高校",
  "大学1年",
  "大学2年",
  "大学3年",
  "大学4年",
  "不明",
] as const;

export type EpisodePeriod = (typeof EPISODE_PERIODS)[number];

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
   変化が語られていなければ空文字。感情そのものが語られていなければ空文字。
9. period は出来事が起きた時期を次から1つ選ぶ:
   ${EPISODE_PERIODS.join(" / ")}
   学生が「高校2年のとき」「3年の春」のように語っていればそれに従う。
   語られていなければ「不明」を選ぶ。学年や入学年から逆算して推測しない。`;

/** One line of the transcript as the extractor sees it. */
export type TranscriptLine = { role: "user" | "ai"; text: string };

export function buildExtractionPrompt(
  transcript: TranscriptLine[],
  /**
   * Cards already saved from this same 壁打ち.
   *
   * Extraction runs repeatedly on a growing conversation now, so most runs are
   * looking at a transcript they have mostly seen before. Naming what is
   * already on file is what turns "extract an episode" into "extract the one
   * that is not there yet" — without it, a long 壁打ち produces the same card
   * over and over.
   */
  alreadySaved: string[] = [],
): string {
  const log = transcript
    .map((m) => `${m.role === "user" ? "学生" : "AI"}: ${m.text}`)
    .join("\n");

  const saved = alreadySaved.length
    ? `

【この壁打ちから既に保存済みのエピソード】
${alreadySaved.map((t) => `- ${t}`).join("\n")}

これらと同じ出来事は、もう保存しないでください。
まだ残していない出来事が語られていれば、それを1件だけ抽出してください。
既存のエピソードに、後から語られた事実が加わっている場合に限り、
同じタイトルのまま、より詳しい内容で抽出し直してかまいません。
新しく残せるものが無ければ、${SKIP_TOOL_NAME} を呼んでください。`
    : `

まだ具体的な出来事が語られていない場合は、無理に作らず ${SKIP_TOOL_NAME} を呼んでください。`;

  return `次の壁打ちのログから、エピソードを1件だけ抽出してください。
複数の話題がある場合は、学生が最も具体的に語った1件を選びます。

----- ログ ここから -----
${log}
----- ログ ここまで -----${saved}`;
}

/**
 * The extraction call, as a tool Claude is forced to call.
 *
 * A tool rather than `output_config.format`: structured outputs are only
 * available on part of the model range, and CHAT_MODEL is an environment
 * variable, so the route has to work on whatever is put there. Forced tool use
 * gets a schema-validated object out of every model that can call tools at all.
 */
export const EPISODE_TOOL_NAME = "save_episode";

/**
 * The other thing the model is allowed to do: nothing.
 *
 * Automatic extraction runs on conversations that may have nothing new in them
 * yet, so "there is no episode here" has to be a first-class answer rather than
 * a card invented to satisfy a forced tool call.
 */
export const SKIP_TOOL_NAME = "no_new_episode";

export const SKIP_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    reason: {
      type: "string",
      description: "残せるエピソードが無いと判断した理由を一文で。",
    },
  },
  required: ["reason"],
  additionalProperties: false,
} as const;

export const EPISODE_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "学生の言葉を使った25字以内の一文。体言止めでよい。",
    },
    tag: { type: "string", enum: [...EPISODE_TAGS] },
    period: {
      type: "string",
      enum: [...EPISODE_PERIODS],
      description: "出来事が起きた時期。語られていなければ「不明」。推測しない。",
    },
    emotion: {
      type: "string",
      description: "語られた感情の変化を「悔しさ → 手応え」の形で。なければ空文字。",
    },
    star: {
      type: "object",
      properties: {
        S: { type: "string", description: "状況 — いつ、どんな場面だったか" },
        T: { type: "string", description: "課題 — 何を目指した / 求められたか" },
        A: { type: "string", description: "行動 — 実際に何をしたか" },
        R: { type: "string", description: "結果 — 何が起きたか" },
      },
      required: ["S", "T", "A", "R"],
      additionalProperties: false,
    },
    learn: {
      type: "string",
      description: "学生自身が言葉にした学び。語られていなければ空文字。",
    },
  },
  required: ["title", "tag", "period", "emotion", "star", "learn"],
  additionalProperties: false,
} as const;

/**
 * The same schema in Gemini's dialect, for the rollback path in
 * lib/server/gemini.ts. Plain strings rather than the SDK's `Type` enum so this
 * file stays independent of @google/genai.
 */
export const EPISODE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    tag: { type: "STRING", enum: EPISODE_TAGS },
    period: { type: "STRING", enum: EPISODE_PERIODS },
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
  required: ["title", "tag", "period", "emotion", "star", "learn"],
} as const;

export type ExtractedEpisode = {
  title: string;
  tag: string;
  period: EpisodePeriod;
  emotion: string;
  star: { S: string; T: string; A: string; R: string };
  learn: string;
};
