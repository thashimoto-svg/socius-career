/**
 * Drive a long 壁打ち against the real Gemini API and then extract from it.
 *
 * Written for the 「16ラリー前後で応答が止まる」 report: the cause was the Gemini
 * free-tier cap of 20 requests per project per day for gemini-2.5-flash, so the
 * only way to know the app survives a 20-往復 conversation is to actually run
 * one. This uses the app's own prompts, sliding window and retry wrapper — the
 * only things it skips are Firebase auth and Firestore.
 *
 *   node --experimental-strip-types --import ./scripts/ts-resolve.mjs \
 *     scripts/simulate-long-conversation.mjs [rallies]
 *
 * Budget: rallies + 2 requests (the AI's opening line, and the extraction).
 * On the free tier this cannot finish — 22 rallies needs 24 requests against a
 * limit of 20 — which is the same wall a student hits. Paced to stay under the
 * 5 requests/minute limit unless FAST=1.
 */
import fs from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const APP = path.resolve(HERE, "..");

// The key lives in .env.local, which the dev server reads for us but a bare
// node process does not.
for (const line of fs.readFileSync(path.join(APP, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { buildChatSystemPrompt, buildOpeningInstruction } = await import(
  "../prompts/modes/index.ts"
);
const { buildExtractionPrompt, EXTRACTION_SYSTEM_PROMPT, EPISODE_RESPONSE_SCHEMA } =
  await import("../prompts/extract/index.ts");
const {
  callGemini,
  CHAT_MODEL,
  EXTRACT_MODEL,
  getGemini,
  historyWindow,
  isGeminiFailure,
  parseMessages,
  toGeminiContents,
} = await import("../lib/server/gemini.ts");

const RALLIES = Number(process.argv[2] ?? 22);
const PACE_MS = process.env.FAST === "1" ? 0 : 13_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A student who is actually doing the exercise: concrete, and long enough that
// the transcript grows at a realistic rate.
const STUDENT_TURNS = [
  "3年の春、サッカー部で副キャプテンになりました。練習の雰囲気が緩いのが気になっていました。",
  "具体的には、練習開始の時間に半分くらいしか揃っていなくて、アップが毎回ずれていました。",
  "自分から言い出しました。ミーティングで、集合時間を10分前倒しにしたいと提案しました。",
  "反発はありました。バイトがあるから無理だという人が3人くらいいました。",
  "その3人には練習後に個別で話を聞きました。シフトの時間を聞いて、週2回だけ免除にしました。",
  "全体には言いませんでした。特別扱いに見えると思ったので、自分が調整役として引き受けました。",
  "2ヶ月くらいで集合率は9割になりました。アップが揃うようになって、練習時間が実質15分増えました。",
  "嬉しかったですが、リーグの結果は5位で前年と同じでした。そこは正直悔しかったです。",
  "自分では、練習の質までは変えられなかったからだと思っています。量は増えたけれど中身は同じでした。",
  "監督には相談していませんでした。学生が決めることだと思い込んでいた気がします。",
  "今なら先に相談します。自分たちで抱えるより、使える人を使ったほうが早かったです。",
  "免除にした3人のうち1人は、後から自分で時間を作って来るようになりました。それは嬉しかったです。",
  "その子には特に何も言っていません。ただ毎回、来たときに普通に話しかけていました。",
  "自分は、正面から説得するより、一人ずつ事情を聞くほうが向いているのかもしれません。",
  "バイトでも同じことをしていました。居酒屋で、新人が辞めそうなときに個別で話を聞いていました。",
  "そのときも辞めるのを止められた人と、止められなかった人がいました。半々くらいです。",
  "止められなかったのは、話を聞くのが遅かったときです。もう決めた後だと何を言っても遅かったです。",
  "だから最近は、様子が変わったと思ったらその日に声をかけるようにしています。",
  "自分が大事にしているのは、たぶん、人が抜けていかないことだと思います。",
  "言葉にするのは難しいですが、そこにいる人が続けられる状態を作りたいのだと思います。",
  "部活でもバイトでも、辞める人を減らすほうに動いていたので、そこは一貫している気がします。",
  "就活でも、人が続けられる仕組みを作る側に回りたいと思っています。",
  "ただ、それが仕事としてどういう職種になるのかは、まだよく分かっていません。",
  "人事なのか、現場のマネジメントなのか、そこはまだ調べられていないところです。",
  "調べるとしたら、まずは実際にやっている人の話を聞くところからだと思います。",
];

const profile = { grade: "大学3年", club: "サッカー部", industries: ["メーカー", "商社"] };
const theme = "サッカー部の経験";
const mode = "counselor";
const systemInstruction = buildChatSystemPrompt({ profile, mode, theme });

/** One turn, exactly as app/api/chat/route.ts asks for it. */
async function chatTurn(transcript) {
  const opening = transcript.length === 0;
  const sent = opening ? [] : historyWindow(parseMessages(transcript));

  return callGemini("simulate", async () => {
    const stream = await getGemini().models.generateContentStream({
      model: CHAT_MODEL,
      contents: opening
        ? [{ role: "user", parts: [{ text: buildOpeningInstruction() }] }]
        : toGeminiContents(sent),
      config: {
        systemInstruction,
        temperature: 0.9,
        maxOutputTokens: 800,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    let text = "";
    let usage = null;
    let finish = null;
    for (;;) {
      const { value, done } = await stream.next();
      if (done) break;
      if (value.text) text += value.text;
      if (value.usageMetadata) usage = value.usageMetadata;
      if (value.candidates?.[0]?.finishReason) finish = value.candidates[0].finishReason;
    }
    if (!text) throw new Error("empty reply");
    return { text, usage, finish, sentCount: sent.length };
  });
}

function report(error) {
  if (isGeminiFailure(error)) {
    console.log(`   → ${error.kind}: ${error.message}`);
    if (error.kind === "daily-quota") {
      console.log(
        "   → これは無料枠の1日20リクエスト上限です。日付が変わるか、\n" +
          "     APIキーを課金プロジェクトのものに替えるまで先に進めません。",
      );
    }
  } else {
    console.log(`   → ${error?.message ?? error}`);
  }
}

console.log(
  `\n${RALLIES}往復をシミュレートします(必要リクエスト数: ${RALLIES + 2}回)` +
    `${PACE_MS ? ` / ${PACE_MS / 1000}秒間隔` : " / 間隔なし"}\n`,
);

const transcript = [];
let requests = 0;
let failed = null;

// The AI opens a new session, which is a request of its own.
try {
  const first = await chatTurn(transcript);
  requests += 1;
  transcript.push({ role: "ai", text: first.text });
  console.log(`opening  | in ${first.usage?.promptTokenCount} tok | ${first.text.length}字`);
} catch (e) {
  console.log("opening  | 失敗");
  report(e);
  failed = e;
}

for (let rally = 1; rally <= RALLIES && !failed; rally += 1) {
  if (PACE_MS) await sleep(PACE_MS);
  transcript.push({
    role: "user",
    text: STUDENT_TURNS[(rally - 1) % STUDENT_TURNS.length],
  });

  try {
    const r = await chatTurn(transcript);
    requests += 1;
    transcript.push({ role: "ai", text: r.text });
    console.log(
      `rally ${String(rally).padStart(2)} | 送信 ${String(r.sentCount).padStart(2)}件 | ` +
        `in ${String(r.usage?.promptTokenCount).padStart(4)} out ${r.usage?.candidatesTokenCount} tok | ` +
        `${r.finish} | ${r.text.length}字`,
    );
  } catch (e) {
    console.log(`rally ${rally} | 失敗(累計 ${requests} リクエスト)`);
    report(e);
    failed = e;
  }
}

console.log(
  `\n往復: ${transcript.filter((m) => m.role === "user").length} / ${RALLIES}` +
    `  ・ 保存済みの全履歴: ${transcript.length}件`,
);

// Extraction, from the full transcript rather than the chat window.
if (!failed) {
  if (PACE_MS) await sleep(PACE_MS);
  try {
    const res = await callGemini("simulate-extract", () =>
      getGemini().models.generateContent({
        model: EXTRACT_MODEL,
        contents: buildExtractionPrompt(historyWindow(parseMessages(transcript), 20)),
        config: {
          systemInstruction: EXTRACTION_SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: EPISODE_RESPONSE_SCHEMA,
          temperature: 0.2,
          thinkingConfig: { thinkingBudget: 1024 },
          maxOutputTokens: 6000,
        },
      }),
    );
    const u = res.usageMetadata;
    console.log(
      `\nextract  | in ${u?.promptTokenCount} out ${u?.candidatesTokenCount} ` +
        `(うち thinking ${u?.thoughtsTokenCount ?? 0}) tok | ${res.candidates?.[0]?.finishReason}`,
    );
    const episode = JSON.parse(res.text);
    console.log(`  title : ${episode.title}`);
    console.log(`  tag   : ${episode.tag}   emotion: ${episode.emotion}`);
    for (const k of ["S", "T", "A", "R"]) {
      console.log(`  ${k}     : ${(episode.star?.[k] ?? "").slice(0, 70)}`);
    }
    console.log(`  learn : ${(episode.learn ?? "").slice(0, 70)}`);
    console.log("\n✅ 長い会話からの抽出に成功しました\n");
  } catch (e) {
    console.log("\nextract  | 失敗");
    report(e);
    failed = e;
  }
}

process.exit(failed ? 1 : 0);
