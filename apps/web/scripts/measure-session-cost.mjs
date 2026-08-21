/**
 * What one 壁打ち costs, at six rallies of history and at sixteen.
 *
 * Replays the same scripted conversation through both window sizes against the
 * real API, and prices the reported usage. Real calls rather than arithmetic on
 * token counts, because the only way to know a cache breakpoint engaged is to
 * read `cache_read_input_tokens` off a response that actually happened — a
 * breakpoint under the minimum prefix silently caches nothing and looks
 * identical in a spreadsheet.
 *
 * Both runs are cached. That is the whole question this file was re-pointed at:
 * the earlier version compared 12往復 uncached against 6往復 cached, which
 * measured two changes at once. Widening the window is only affordable if the
 * turns it adds are read out of the cache rather than written again, and
 * `cacheRead` climbing while `input` stays flat is what that looks like.
 *
 *   npm run measure:cost
 */
import {
  buildChatSystemBlocks,
  buildOpeningInstruction,
  EMPTY_WORKSHEET,
  mergeWorksheet,
  readReply,
  worksheetPrompt,
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

/**
 * A scripted student, so both runs see byte-identical transcripts.
 *
 * Twenty turns rather than ten: at ten, a six-rally window and a sixteen-rally
 * window are the same request for the first six turns and differ only at the
 * end, which understates both the cost and the point.
 */
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
  "そのあと、新人の子が入ってきて、教える係も任されました。",
  "最初は口で説明していましたが、あまり伝わりませんでした。",
  "やって見せてから同じことをやってもらう形に変えました。",
  "その子は3ヶ月くらいで一人でホールを回せるようになりました。",
  "自分が教わったときは、放っておかれて苦しかった記憶があります。",
  "だから同じ思いはさせたくないと思っていました。",
  "店長からは、後輩の定着率が上がったと言われました。",
  "辞める人が減ったのは、たぶんそこが大きかったと思います。",
  "自分は、人が続けられる状態を作るのが好きなんだと思います。",
  "就活でも、そういう仕事を選びたいと思っています。",
];

/** One turn, at the given window size — otherwise exactly what /api/chat sends. */
function requestAt(rallies) {
  return (transcript, sheet) => {
    const history = historyWindowWithState(transcript, rallies);
    return {
      model: CHAT_MODEL,
      max_tokens: CHAT_MAX_TOKENS,
      system: buildChatSystemBlocks({ profile: PROFILE, mode: MODE, theme: THEME }),
      messages:
        transcript.length === 0
          ? [{ role: "user", content: buildOpeningInstruction() }]
          : toAnthropicMessages(history.messages, history.complete, worksheetPrompt(sheet)),
    };
  };
}

async function runSession(label, build) {
  const client = getAnthropic();
  const transcript = [];
  const rows = [];
  let sheet = EMPTY_WORKSHEET;
  let total = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

  // Turn 0 is the AI's opening line; then the student's turns.
  for (let turn = 0; turn <= STUDENT_TURNS.length; turn += 1) {
    if (turn > 0) transcript.push({ role: "user", text: STUDENT_TURNS[turn - 1] });

    const message = await client.messages.create(build(transcript, sheet));
    const u = toTokenUsage(message.usage);
    total = {
      input: total.input + u.input,
      output: total.output + u.output,
      cacheWrite: total.cacheWrite + u.cacheWrite,
      cacheRead: total.cacheRead + u.cacheRead,
    };
    rows.push({ turn, ...u, usd: cost(u) });

    const raw = message.content.find((b) => b.type === "text")?.text ?? "";
    const reply = readReply(raw);
    sheet = mergeWorksheet(sheet, reply.sheet);
    transcript.push({ role: "ai", text: reply.text });
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

// Cold first, so the shared prefix is warm for everything after it — the same
// order a real cohort produces, where one student's turn keeps the block warm
// for the next student's.
const before = await runSession("BEFORE — 6往復 (キャッシュあり)", requestAt(6));
const after = await runSession("AFTER — 16往復 (キャッシュあり)", requestAt(16));

const pct = (a, b) => `${(((b - a) / a) * 100).toFixed(1)}%`;
console.log("\n=== 差分 ===");
console.log(`BEFORE  6往復   $${before.usd.toFixed(6)}  / ¥${(before.usd * USD_PER_JPY).toFixed(2)}`);
console.log(
  `AFTER  16往復   $${after.usd.toFixed(6)}  / ¥${(after.usd * USD_PER_JPY).toFixed(2)}` +
    `   ${after.usd >= before.usd ? "+" : ""}${pct(before.usd, after.usd)}`,
);
console.log(
  `\n入力の内訳   BEFORE  uncached ${before.total.input}  cacheR ${before.total.cacheRead}` +
    `  cacheW ${before.total.cacheWrite}`,
);
console.log(
  `             AFTER   uncached ${after.total.input}  cacheR ${after.total.cacheRead}` +
    `  cacheW ${after.total.cacheWrite}`,
);
