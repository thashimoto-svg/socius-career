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

// 会話の原稿は poc-fixture.mjs にある。Llama の PoC が同じ会話を流すので、
// 原稿が二つあると二本の数字が比べられなくなる。
const { PROFILE, THEME, MODE, PLANTED, STUDENT_TURNS } = await import("./poc-fixture.mjs");

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
