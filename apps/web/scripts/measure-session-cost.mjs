/**
 * What one 壁打ち session costs, before and after.
 *
 * Replays the same scripted ten-rally conversation through both request shapes
 * against the real API, and prices the reported usage. Real calls rather than
 * arithmetic on token counts, because the only way to know a cache breakpoint
 * engaged is to read `cache_read_input_tokens` off a response that actually
 * happened — a breakpoint under the minimum prefix silently caches nothing and
 * looks identical in a spreadsheet.
 *
 *   node --experimental-strip-types --import ./scripts/ts-resolve.mjs \
 *     scripts/measure-session-cost.mjs
 */
import {
  buildChatSystemBlocks,
  buildOpeningInstruction,
  INVARIANT_CORE,
  profileBlock,
  TONES,
} from "../prompts/index.ts";
import {
  CHAT_MAX_TOKENS,
  CHAT_MODEL,
  getAnthropic,
  toAnthropicMessages,
  toTokenUsage,
} from "../lib/server/anthropic.ts";
import { historyWindowWithState } from "../lib/server/transcript.ts";

/** claude-sonnet-4-6 list price, USD per million tokens. */
const PRICE = {
  input: 3.0,
  output: 15.0,
  cacheWrite: 3.0 * 1.25,
  cacheRead: 3.0 * 0.1,
};

const USD_PER_JPY = 155;

function cost(u) {
  return (
    (u.input * PRICE.input +
      u.output * PRICE.output +
      u.cacheWrite * PRICE.cacheWrite +
      u.cacheRead * PRICE.cacheRead) /
    1_000_000
  );
}

const PROFILE = {
  grade: "大学3年",
  club: "アルバイト",
  industries: ["人材", "IT・ソフトウェア", "コンサルティング"],
};
const THEME = "アルバイトの経験";
const MODE = "counselor";

/** A scripted student, so both runs see byte-identical transcripts. */
const STUDENT_TURNS = [
  "居酒屋のホールで2年間バイトしていました。",
  "忙しい時間帯に注文が詰まって、クレームが増えたことがありました。",
  "自分が上がったときに、ドリンクの担当を固定してみようと提案しました。",
  "店長には最初、人が減るから無理だと言われました。",
  "それでも一度だけ試させてほしいと頼んで、金曜の夜にやってみました。",
  "結果としてドリンクの提供時間が半分くらいになりました。",
  "数えていたわけではないですが、待たされている人が明らかに減りました。",
  "納得してもらうには、自分でやってみせるしかないと思ったからです。",
  "言い出すのは怖かったですが、黙っている方が嫌でした。",
  "困っている人がそのままなのが、いちばん落ち着かないんだと思います。",
];

/** The 12-rally, uncached shape this app sent before the change. */
function beforeRequest(transcript) {
  const themeBlock = `\n\n【今日のテーマ】\n${THEME}\nこのテーマから逸れそうなときは、自然に引き戻してください。`;
  return {
    model: CHAT_MODEL,
    max_tokens: CHAT_MAX_TOKENS,
    system: [INVARIANT_CORE, profileBlock(PROFILE), TONES[MODE].instruction + themeBlock].join(
      "\n\n",
    ),
    messages:
      transcript.length === 0
        ? [{ role: "user", content: buildOpeningInstruction() }]
        : toAnthropicMessages(historyWindowWithState(transcript, 12).messages),
  };
}

/** The 6-rally, three-breakpoint shape it sends now. */
function afterRequest(transcript) {
  const history = historyWindowWithState(transcript, 6);
  return {
    model: CHAT_MODEL,
    max_tokens: CHAT_MAX_TOKENS,
    system: buildChatSystemBlocks({ profile: PROFILE, mode: MODE, theme: THEME }),
    messages:
      transcript.length === 0
        ? [{ role: "user", content: buildOpeningInstruction() }]
        : toAnthropicMessages(history.messages, history.complete),
  };
}

async function runSession(label, build) {
  const client = getAnthropic();
  const transcript = [];
  const rows = [];
  let total = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

  // Turn 0 is the AI's opening line; then ten student turns.
  for (let turn = 0; turn <= STUDENT_TURNS.length; turn += 1) {
    if (turn > 0) transcript.push({ role: "user", text: STUDENT_TURNS[turn - 1] });

    const message = await client.messages.create(build(transcript));
    const u = toTokenUsage(message.usage);
    total = {
      input: total.input + u.input,
      output: total.output + u.output,
      cacheWrite: total.cacheWrite + u.cacheWrite,
      cacheRead: total.cacheRead + u.cacheRead,
    };
    rows.push({ turn, ...u, usd: cost(u) });

    const reply = message.content.find((b) => b.type === "text")?.text ?? "";
    transcript.push({ role: "ai", text: reply });
  }

  console.log(`\n=== ${label} ===`);
  console.log(" turn   input  output  cacheW  cacheR      USD");
  for (const r of rows) {
    console.log(
      `${String(r.turn).padStart(5)} ${String(r.input).padStart(7)} ` +
        `${String(r.output).padStart(7)} ${String(r.cacheWrite).padStart(7)} ` +
        `${String(r.cacheRead).padStart(7)}  ${r.usd.toFixed(6)}`,
    );
  }
  const usd = cost(total);
  console.log(
    `TOTAL ${String(total.input).padStart(7)} ${String(total.output).padStart(7)} ` +
      `${String(total.cacheWrite).padStart(7)} ${String(total.cacheRead).padStart(7)}  ${usd.toFixed(6)}`,
  );
  console.log(`      = $${usd.toFixed(6)} / ¥${(usd * USD_PER_JPY).toFixed(2)} per session`);
  return { total, usd };
}

console.log(`model: ${CHAT_MODEL}   ${STUDENT_TURNS.length} 往復 + 初回発話`);

const before = await runSession("BEFORE — 12往復, キャッシュなし", beforeRequest);
const afterCold = await runSession("AFTER — 6往復, キャッシュあり (コールド)", afterRequest);
const afterWarm = await runSession("AFTER — 6往復, キャッシュあり (ウォーム)", afterRequest);

const pct = (a, b) => `${(((a - b) / a) * 100).toFixed(1)}%`;
console.log("\n=== 差分 ===");
console.log(`BEFORE            $${before.usd.toFixed(6)}`);
console.log(
  `AFTER (cold)      $${afterCold.usd.toFixed(6)}   −${pct(before.usd, afterCold.usd)}`,
);
console.log(
  `AFTER (warm)      $${afterWarm.usd.toFixed(6)}   −${pct(before.usd, afterWarm.usd)}`,
);
