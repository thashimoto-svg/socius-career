/**
 * 20往復してから、序盤の話を覚えているかを実際に聞いてみる。
 *
 * βフィードバック 8/18:「20往復くらいすると最初の話を忘れている」。窓は16往復
 * なので、20往復目の依頼には最初の4往復が入っていない。エピソードシートは、その
 * 落ちた先に何かを残しておくために足したものだった——足したかどうかではなく、
 * 効いているかどうかを見るには、実際に落としてから聞き返すしかない。
 *
 * だから確かめ方は一つ: **窓から確実に溢れる位置に固有の事実を置き、20往復
 * 進めてから、その事実を聞き返す。** シートに文字列が残っているかどうかも見る
 * が、それは補助でしかない。学生が受け取るのは返答であって、シートではない。
 *
 *   npm run verify:memory              # シートあり(本番の形)
 *   npm run verify:memory -- --control # シート無しと並べて走らせる
 *
 * 実際のAPIを叩く。1回の実行で約24リクエスト、--control では約48。
 */
import fs from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const APP = path.resolve(HERE, "..");

// 鍵は .env.local にある。dev サーバーは読んでくれるが、素の node は読まない。
for (const line of fs.readFileSync(path.join(APP, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const {
  buildChatSystemBlocks,
  buildOpeningInstruction,
  EMPTY_WORKSHEET,
  mergeWorksheet,
  readReply,
  worksheetPrompt,
} = await import("../prompts/index.ts");
const { CHAT_MAX_TOKENS, CHAT_MODEL, getAnthropic, toAnthropicMessages, toTokenUsage } =
  await import("../lib/server/anthropic.ts");
const { historyWindowWithState, HISTORY_RALLIES } = await import(
  "../lib/server/transcript.ts"
);

const CONTROL = process.argv.includes("--control");

const PROFILE = { grade: "大学3年", club: "サッカー部", industries: ["メーカー", "商社"] };
const THEME = "サッカー部の経験";
const MODE = "counselor";

/**
 * 序盤に置く固有の事実。
 *
 * 数字と役職を選んである。「頑張った」は覚えていなくても会話が成立してしまう
 * ので、忘れたことが外から見えない——10分と3人と副キャプテンは、間違えたら
 * 間違いだと分かる。
 */
const PLANTED = [
  {
    label: "役職(副キャプテン)",
    ask: "ひとつ確認させてください。私が部活でやっていた役職は何でしたか。",
    needles: ["副キャプテン"],
  },
  {
    label: "集合時間(10分前倒し)",
    ask: "集合時間の話ですが、何分早めることにしたんでしたっけ。",
    needles: ["10分", "十分", "１０分"],
  },
  {
    // 「最初に反対していたのは何人でしたか」と聞いていた時期がある。シートには
    // 「反対した3人」と残っているのに、モデルは「そのうち何人が"最初から"かは
    // 聞けていない」と答えを控えた。会話に無かった限定を問いに足していたのは
    // こちらで、覚えているかどうかとは別の話だった。聞くのは、言われたこと。
    label: "反対した人数(3人)",
    ask: "バイトがあるから無理だと言っていたのは、何人でしたっけ。",
    needles: ["3人", "三人", "３人"],
  },
];

/**
 * 学生の20往復。
 *
 * 最初の5往復に PLANTED の事実が入っていて、そこから先は別の話が続く。16往復の
 * 窓は20往復目には5往復目以降しか持っていないので、聞き返す時点で「役職」「10分」
 * 「3人」はどれも履歴の外にある。
 */
const STUDENT_TURNS = [
  "3年の春、サッカー部で副キャプテンになりました。練習の雰囲気が緩いのが気になっていました。",
  "具体的には、練習開始の時間に半分くらいしか揃っていなくて、アップが毎回ずれていました。",
  "自分から言い出しました。ミーティングで、集合時間を10分前倒しにしたいと提案しました。",
  "反発はありました。バイトがあるから無理だという人が3人いました。",
  "その3人には練習後に個別で話を聞きました。シフトの時間を聞いて、週2回だけ免除にしました。",
  "全体には言いませんでした。特別扱いに見えると思ったので、自分が調整役として引き受けました。",
  "2ヶ月くらいで集合率は9割になりました。アップが揃うようになって、練習時間が実質15分増えました。",
  "嬉しかったですが、リーグの結果は5位で前年と同じでした。そこは正直悔しかったです。",
  "自分では、練習の質までは変えられなかったからだと思っています。量は増えたけれど中身は同じでした。",
  "監督には相談していませんでした。学生が決めることだと思い込んでいた気がします。",
  "今なら先に相談します。自分たちで抱えるより、使える人を使ったほうが早かったです。",
  "免除にした1人は、後から自分で時間を作って来るようになりました。それは嬉しかったです。",
  "その子には特に何も言っていません。ただ毎回、来たときに普通に話しかけていました。",
  "自分は、正面から説得するより、一人ずつ事情を聞くほうが向いているのかもしれません。",
  "バイトでも同じことをしていました。居酒屋で、新人が辞めそうなときに個別で話を聞いていました。",
  "そのときも辞めるのを止められた人と、止められなかった人がいました。半々くらいです。",
  "止められなかったのは、話を聞くのが遅かったときです。もう決めた後だと何を言っても遅かったです。",
  "だから最近は、様子が変わったと思ったらその日に声をかけるようにしています。",
  "自分が大事にしているのは、たぶん、人が抜けていかないことだと思います。",
  "言葉にするのは難しいですが、そこにいる人が続けられる状態を作りたいのだと思います。",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 一往復。/api/chat が組み立てるものと同じ形。 */
async function turn(transcript, sheet, withSheet) {
  const opening = transcript.length === 0;
  const history = historyWindowWithState(transcript);

  const message = await getAnthropic().messages.create({
    model: CHAT_MODEL,
    max_tokens: CHAT_MAX_TOKENS,
    system: buildChatSystemBlocks({ profile: PROFILE, mode: MODE, theme: THEME }),
    messages: opening
      ? [{ role: "user", content: buildOpeningInstruction() }]
      : toAnthropicMessages(
          history.messages,
          history.complete,
          // --control はここだけを外す。窓もプロンプトも本番のままで、
          // 「シートが同封されているかどうか」だけが違う二本になる。
          withSheet ? worksheetPrompt(sheet) : undefined,
        ),
  });

  const raw = message.content.find((b) => b.type === "text")?.text ?? "";
  return {
    ...readReply(raw),
    usage: toTokenUsage(message.usage),
    sent: history.messages.length,
    complete: history.complete,
  };
}

function found(text, needles) {
  return needles.some((n) => text.includes(n));
}

async function run(withSheet) {
  const label = withSheet ? "シートあり" : "シート無し(対照)";
  console.log(`\n════ ${label} ════`);

  const transcript = [];
  let sheet = EMPTY_WORKSHEET;

  const opening = await turn(transcript, sheet, withSheet);
  sheet = mergeWorksheet(sheet, opening.sheet);
  transcript.push({ role: "ai", text: opening.text });

  for (let rally = 1; rally <= STUDENT_TURNS.length; rally += 1) {
    transcript.push({ role: "user", text: STUDENT_TURNS[rally - 1] });
    const reply = await turn(transcript, sheet, withSheet);
    sheet = mergeWorksheet(sheet, reply.sheet);
    transcript.push({ role: "ai", text: reply.text });

    const outside = reply.complete ? "" : `  ← 履歴から ${transcript.length - 1 - reply.sent} 件落ちている`;
    console.log(
      `rally ${String(rally).padStart(2)} | 送信 ${String(reply.sent).padStart(2)}件 | ` +
        `in ${String(reply.usage.input).padStart(4)} cacheR ${String(reply.usage.cacheRead).padStart(5)} | ` +
        `${reply.text.length}字${outside}`,
    );
    // 秒間の上限に当てないための間。API側の都合であって、アプリの都合ではない。
    await sleep(400);
  }

  console.log(
    `\n窓は ${HISTORY_RALLIES} 往復。${STUDENT_TURNS.length} 往復したので、` +
      `序盤の ${STUDENT_TURNS.length - HISTORY_RALLIES} 往復は履歴の外にあります。`,
  );

  if (withSheet) {
    console.log("\n── いまのシート ──");
    for (const [k, v] of Object.entries(sheet)) {
      if (Array.isArray(v) ? v.length : v) console.log(`  ${k}: ${Array.isArray(v) ? v.join(" / ") : v}`);
    }
  }

  // ── 聞き返す ──
  console.log("\n── 聞き返す ──");
  const results = [];
  for (const probe of PLANTED) {
    transcript.push({ role: "user", text: probe.ask });
    const reply = await turn(transcript, sheet, withSheet);
    sheet = mergeWorksheet(sheet, reply.sheet);
    transcript.push({ role: "ai", text: reply.text });

    const sheetText = Object.values(sheet)
      .map((v) => (Array.isArray(v) ? v.join(" ") : v))
      .join(" ");
    const inReply = found(reply.text, probe.needles);
    const inSheet = found(sheetText, probe.needles);
    // 覚えていることと、覚えている仕組みを見せないことは別の話。「シートを見ると
    // 副キャプテンと書いてあります」は事実として正しく、会話としては壊れている
    // ——学生が話している相手が、急に自分の内部状態を読み上げはじめる。
    // 一度目の検証で実際に出た漏れ方なので、ここで見る。
    const leaked = /シート|worksheet|\[sheet/i.test(reply.text);
    results.push({ ...probe, inReply, inSheet, leaked });

    console.log(`\n  Q: ${probe.ask}`);
    console.log(`  A: ${reply.text.replace(/\n/g, " ").slice(0, 120)}`);
    console.log(
      `  → 返答に${inReply ? "ある" : "ない"} / シートに${inSheet ? "ある" : "ない"}` +
        `${leaked ? " / ⚠ 本文が仕組みに言及している" : ""}`,
    );
    await sleep(400);
  }

  console.log(`\n── ${label} の結果 ──`);
  for (const r of results) {
    console.log(
      `  ${r.inReply && !r.leaked ? "ok  " : "FAIL"} ${r.label}` +
        `${r.leaked ? "(覚えてはいるが、仕組みを見せている)" : ""}`,
    );
  }
  return results;
}

const withSheet = await run(true);

if (CONTROL) {
  const without = await run(false);
  console.log("\n════ 並べて ════");
  for (let i = 0; i < withSheet.length; i += 1) {
    console.log(
      `  ${withSheet[i].label.padEnd(22)} シートあり ${withSheet[i].inReply ? "○" : "×"}` +
        `   シート無し ${without[i].inReply ? "○" : "×"}`,
    );
  }
}

const forgotten = withSheet.filter((r) => !r.inReply);
const leaks = withSheet.filter((r) => r.leaked);
if (forgotten.length === 0 && leaks.length === 0) {
  console.log(`\n✅ 履歴から落ちた ${withSheet.length} 件とも、聞き返して答えられました\n`);
} else {
  if (forgotten.length > 0) {
    console.log(`\n❌ ${forgotten.length}件 忘れています: ${forgotten.map((f) => f.label).join(", ")}`);
  }
  if (leaks.length > 0) {
    console.log(`❌ ${leaks.length}件、本文が仕組みに言及しました: ${leaks.map((f) => f.label).join(", ")}`);
  }
  console.log("");
}
const failed = [...new Set([...forgotten, ...leaks])];
process.exit(failed.length === 0 ? 0 : 1);
