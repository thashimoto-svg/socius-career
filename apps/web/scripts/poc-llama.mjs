/**
 * Swallow 8B は、このアプリのプロンプトを守れるのか。
 *
 * §2.3 の見立ては「日本語の流暢さでは落ちない。落ちるなら指示の遵守で落ちる」
 * だった。5,069字のシステムプロンプトに絶対ルールが9項目あり、そのうえ毎ターン
 * `[sheet]` を決まった書式で出させている——8Bクラスが崩れるとしたらそこで、
 * そして**そこは感想ではなく数えられる**。判定器はすでにリポジトリにある。
 *
 * だからこの台本は品質の良し悪しを論じない。同じ20往復を Claude と
 * ローカルの両方に流し、四つの数と記憶の三問を並べて出すだけにしてある。
 *
 *   # Claude(基準線)
 *   npm run poc:llama -- --backend=claude
 *
 *   # ローカル(Ollama / llama-server)
 *   LOCAL_LLM_URL=http://127.0.0.1:11434/v1 npm run poc:llama -- --backend=local
 *
 * 出力の最後に JSON 一行を吐く。二回分を手元に置けば、そのまま比較表になる。
 */
import fs from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const APP = path.resolve(HERE, "..");

const BACKEND = process.argv.includes("--backend=local") ? "local" : "claude";

// 鍵は .env.local にある。ローカル実行では要らないので、無くても止めない。
const envFile = path.join(APP, ".env.local");
if (BACKEND === "claude" && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
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
const { PROFILE, THEME, MODE, PLANTED, STUDENT_TURNS } = await import("./poc-fixture.mjs");

/**
 * 呼び先。**引数の形は両方で同じ**——それがこの PoC が比較として成立する条件で、
 * プロンプトの組み立ても窓もシートの同封も、分岐の手前で済ませてある。
 */
let call;
let modelLabel;
if (BACKEND === "local") {
  const { localMessages, localHealth, LOCAL_MODEL } = await import("./local-llm.mjs");
  const health = await localHealth();
  console.log(`ローカル: ${health.url}`);
  console.log(`載っているモデル: ${health.models.join(", ") || "(一覧が空)"}`);
  if (health.models.length > 0 && !health.models.includes(LOCAL_MODEL)) {
    console.log(`⚠ LOCAL_LLM_MODEL=${LOCAL_MODEL} は一覧にありません。先に pull してください。`);
  }
  call = localMessages;
  modelLabel = LOCAL_MODEL;
} else {
  call = (args) => getAnthropic().messages.create(args);
  modelLabel = CHAT_MODEL;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 一往復。/api/chat が組み立てるものと同じ形。 */
async function turn(transcript, sheet) {
  const opening = transcript.length === 0;
  const history = historyWindowWithState(transcript);

  const message = await call({
    model: modelLabel,
    max_tokens: CHAT_MAX_TOKENS,
    system: buildChatSystemBlocks({ profile: PROFILE, mode: MODE, theme: THEME }),
    messages: opening
      ? [{ role: "user", content: buildOpeningInstruction() }]
      : toAnthropicMessages(history.messages, history.complete, worksheetPrompt(sheet)),
  });

  const raw = message.content.find((b) => b.type === "text")?.text ?? "";
  return {
    raw,
    ...readReply(raw),
    usage: toTokenUsage(message.usage),
    local: message.local ?? null,
    sent: history.messages.length,
  };
}

/**
 * §2.3 の四つの失敗モードを、返答一つぶん数える。
 *
 * 四つ目(結論・要約を先に出す)だけはここに無い。機械で見分けられないからで、
 * 人手評価に回す——測れないものを測れたことにするほうが、PoC としては危ない。
 */
function score(reply) {
  return {
    // シートが出ていない = 16往復の窓から溢れた話を持ち回る唯一の仕組みが
    // 壊れている。8/18 の「最初の話を忘れている」が再発する経路そのもの。
    sheetMissing: reply.sheet === null,
    // コア原則3。返答は問いひとつで終わる。
    questions: (reply.text.match(/[?？]/g) ?? []).length,
    // コア原則5。吹き出しに収まる長さ。
    overLength: reply.text.length > 250,
    // コア原則9。箇条書き・見出し・Markdown は出さない。
    markdown: /^\s*(?:[-・*+]\s|#{1,6}\s|\d+[.)]\s)/m.test(reply.text) || /\*\*/.test(reply.text),
    length: reply.text.length,
    choices: reply.choices.length,
  };
}

const found = (text, needles) => needles.some((n) => text.includes(n));

// ---------------------------------------------------------------------------

console.log(`\n════ ${BACKEND === "local" ? "ローカル" : "Claude"} / ${modelLabel} ════\n`);

const transcript = [];
let sheet = EMPTY_WORKSHEET;
const rows = [];
const speeds = [];

const opening = await turn(transcript, sheet);
sheet = mergeWorksheet(sheet, opening.sheet);
transcript.push({ role: "ai", text: opening.text });

for (let rally = 1; rally <= STUDENT_TURNS.length; rally += 1) {
  transcript.push({ role: "user", text: STUDENT_TURNS[rally - 1] });
  const reply = await turn(transcript, sheet);
  sheet = mergeWorksheet(sheet, reply.sheet);
  transcript.push({ role: "ai", text: reply.text });

  const s = score(reply);
  rows.push(s);
  if (reply.local) speeds.push(reply.local.tokensPerSecond);

  const flags = [
    s.sheetMissing ? "シート無し" : "",
    s.questions > 1 ? `問い${s.questions}` : "",
    s.overLength ? `${s.length}字` : "",
    s.markdown ? "箇条書き" : "",
  ].filter(Boolean);

  console.log(
    `rally ${String(rally).padStart(2)} | in ${String(reply.usage.input).padStart(5)} ` +
      `out ${String(reply.usage.output).padStart(4)} | ${String(s.length).padStart(3)}字 | ` +
      (reply.local ? `${reply.local.tokensPerSecond.toFixed(1)} tok/s | ` : "") +
      (flags.length ? `⚠ ${flags.join(" / ")}` : "ok"),
  );
  await sleep(BACKEND === "local" ? 0 : 400);
}

// ── 履歴から落ちた話を聞き返す ──
console.log(`\n── 聞き返す(窓は ${HISTORY_RALLIES} 往復。序盤 ${STUDENT_TURNS.length - HISTORY_RALLIES} 往復は外にある) ──`);
const memory = [];
for (const probe of PLANTED) {
  transcript.push({ role: "user", text: probe.ask });
  const reply = await turn(transcript, sheet);
  sheet = mergeWorksheet(sheet, reply.sheet);
  transcript.push({ role: "ai", text: reply.text });

  const inReply = found(reply.text, probe.needles);
  // 覚えていることと、覚えている仕組みを見せないことは別の話。
  const leaked = /シート|worksheet|\[sheet/i.test(reply.text);
  memory.push({ label: probe.label, inReply, leaked });

  console.log(`\n  Q: ${probe.ask}`);
  console.log(`  A: ${reply.text.replace(/\n/g, " ").slice(0, 120)}`);
  console.log(`  → ${inReply ? "ok  " : "FAIL"}${leaked ? " / ⚠ 仕組みに言及" : ""}`);
  await sleep(BACKEND === "local" ? 0 : 400);
}

// ── まとめ ──
const n = rows.length;
const pct = (k) => ((rows.filter(k).length / n) * 100).toFixed(0);
const summary = {
  backend: BACKEND,
  model: modelLabel,
  rallies: n,
  sheetMissingPct: Number(pct((r) => r.sheetMissing)),
  multiQuestionPct: Number(pct((r) => r.questions > 1)),
  overLengthPct: Number(pct((r) => r.overLength)),
  markdownPct: Number(pct((r) => r.markdown)),
  avgLength: Math.round(rows.reduce((a, r) => a + r.length, 0) / n),
  choicesOfferedPct: Number(pct((r) => r.choices >= 2)),
  memoryRecalled: memory.filter((m) => m.inReply && !m.leaked).length,
  memoryProbes: memory.length,
  ...(speeds.length
    ? { avgTokensPerSecond: Number((speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1)) }
    : {}),
};

console.log(`\n── ${modelLabel} の ${n} 往復 ──`);
console.log(`  シートが出なかった    ${summary.sheetMissingPct}%   ← 0% でなければ記憶が壊れる`);
console.log(`  問いが2つ以上         ${summary.multiQuestionPct}%`);
console.log(`  250字超               ${summary.overLengthPct}%   (平均 ${summary.avgLength}字)`);
console.log(`  箇条書き・Markdown    ${summary.markdownPct}%`);
console.log(`  選択肢が出た          ${summary.choicesOfferedPct}%`);
console.log(`  聞き返して答えられた  ${summary.memoryRecalled}/${summary.memoryProbes}`);
if (summary.avgTokensPerSecond) console.log(`  生成速度              ${summary.avgTokensPerSecond} tok/s`);

console.log(`\nJSON: ${JSON.stringify(summary)}\n`);

// 続行判断は §9 の門。シートが一度でも落ちたら、プロンプトだけでは足りない。
process.exit(summary.sheetMissingPct === 0 ? 0 : 1);
