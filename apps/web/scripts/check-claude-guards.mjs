/**
 * Offline checks for the Claude layer that replaced Gemini.
 *
 * Runs without an API key and without spending anything, which is the point:
 * the failures being defended against are quota and overload failures, and the
 * way to be sure the handling is right is to feed it those shapes directly
 * rather than wait to meet them in production again.
 *
 *   node --experimental-strip-types --import ./scripts/ts-resolve.mjs \
 *     scripts/check-claude-guards.mjs
 */
import {
  callAnthropic,
  CHAT_MODEL,
  classifyAnthropicFailure,
  isAiFailure,
  toAnthropicMessages,
} from "../lib/server/anthropic.ts";
import { historyWindow, parseMessages } from "../lib/server/transcript.ts";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name, actual, expected) {
  check(
    name,
    actual === expected,
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`,
  );
}

/** An SDK error, in the shape @anthropic-ai/sdk actually throws. */
const apiError = (status, type, retryAfter = null) => ({
  name: "APIError",
  status,
  message: `${status} ${JSON.stringify({ type: "error", error: { type } })}`,
  headers: new Headers(retryAfter === null ? {} : { "retry-after": String(retryAfter) }),
});

const RATE_LIMIT = apiError(429, "rate_limit_error", 60);
const OVERLOADED = apiError(529, "overloaded_error");
const SERVER_ERROR = apiError(500, "api_error");
const UNAUTHORIZED = apiError(401, "authentication_error");
const FORBIDDEN = apiError(403, "permission_error");
const BAD_REQUEST = apiError(400, "invalid_request_error");

// ---------------------------------------------------------------------------
console.log("\ntoAnthropicMessages — 会話は必ず user から始まる");
// ---------------------------------------------------------------------------

// Every 壁打ち opens with the AI's question, so the raw transcript starts with
// an assistant turn — which the Messages API rejects outright.
const opened = toAnthropicMessages([
  { role: "ai", text: "どんな出来事が思い浮かびますか?" },
  { role: "user", text: "サッカー部で副キャプテンをしていました。" },
]);
eq("AI発話で始まる履歴でも先頭は user", opened[0].role, "user");
eq("AIの最初の問いは捨てずに残す", opened[1].role, "assistant");
eq("学生の返答も残る", opened.length, 3);
check(
  "AIの問いの中身は書き換えない",
  opened[1].content === "どんな出来事が思い浮かびますか?",
  opened[1].content,
);

const fromUser = toAnthropicMessages([{ role: "user", text: "こんにちは" }]);
eq("user から始まる履歴には何も足さない", fromUser.length, 1);
eq("空の履歴は空のまま(初回発話の経路)", toAnthropicMessages([]).length, 0);
eq("ai は assistant に読み替える", toAnthropicMessages([{ role: "user", text: "a" }, { role: "ai", text: "b" }])[1].role, "assistant");

// ---------------------------------------------------------------------------
console.log("\nclassifyAnthropicFailure — 待てば直るものと直らないもの");
// ---------------------------------------------------------------------------

const rate = classifyAnthropicFailure(RATE_LIMIT);
eq("429 → rate-limit", rate.kind, "rate-limit");
eq("429 → 429 のまま返す", rate.status, 429);
eq("429 → retry-after を読む", rate.retryAfterSeconds, 60);
check("429 は再送を促す", rate.message.includes("再送"), rate.message);

const overloaded = classifyAnthropicFailure(OVERLOADED);
eq("529 → overloaded", overloaded.kind, "overloaded");
eq("529 → クライアントには503", overloaded.status, 503);
eq("529 も同じ文言(学生から見れば同じこと)", overloaded.message, rate.message);
eq("500 も overloaded 扱い", classifyAnthropicFailure(SERVER_ERROR).kind, "overloaded");

eq("401 → config(学生が待っても直らない)", classifyAnthropicFailure(UNAUTHORIZED).kind, "config");
eq("403 → config", classifyAnthropicFailure(FORBIDDEN).kind, "config");
check(
  "設定ミスは「少し待って」と言わない",
  !classifyAnthropicFailure(FORBIDDEN).message.includes("待って"),
  classifyAnthropicFailure(FORBIDDEN).message,
);
eq(
  "キー未設定 → config",
  classifyAnthropicFailure(new Error("ANTHROPIC_API_KEY is not set.")).kind,
  "config",
);
eq("400 → unknown/502", classifyAnthropicFailure(BAD_REQUEST).status, 502);
eq("正体不明 → unknown/502", classifyAnthropicFailure(new Error("boom")).status, 502);
check("分類結果は AiFailure として判定できる", isAiFailure(rate) && !isAiFailure(new Error("x")));

// ---------------------------------------------------------------------------
console.log("\ncallAnthropic — リトライするものとしないもの");
// ---------------------------------------------------------------------------

async function attempts(error, { succeedOnAttempt = Infinity } = {}) {
  let n = 0;
  const startedAt = Date.now();
  let thrown = null;
  try {
    await callAnthropic("check", async () => {
      n += 1;
      if (n >= succeedOnAttempt) return "ok";
      throw error;
    });
  } catch (e) {
    thrown = e;
  }
  return { n, ms: Date.now() - startedAt, thrown };
}

const transient = await attempts(OVERLOADED, { succeedOnAttempt: 2 });
eq("529 が一度なら2回目で成功する", transient.n, 2);
check("成功したら例外は投げない", transient.thrown === null);

const persistent = await attempts(OVERLOADED);
eq("529 が続くなら合計3回(初回 + リトライ2回)で諦める", persistent.n, 3);
eq("諦めた後は overloaded として返す", persistent.thrown?.kind, "overloaded");
check("指数バックオフで待っている", persistent.ms >= 2_000, `${persistent.ms}ms`);
check("待ち時間には上限がある", persistent.ms < 6_000, `${persistent.ms}ms`);

// retry-after が60秒でも、学生はスピナーを見ている。
const rateRun = await attempts(RATE_LIMIT);
eq("retry-after が長すぎるときは待たずに返す", rateRun.n, 1);
eq("その場合も rate-limit として返す", rateRun.thrown?.kind, "rate-limit");
check("60秒スピナーを回さない", rateRun.ms < 500, `${rateRun.ms}ms`);

const configRun = await attempts(FORBIDDEN);
eq("設定ミスはリトライしない", configRun.n, 1);
const badRun = await attempts(BAD_REQUEST);
eq("400 はリトライしない(同じ結果になる)", badRun.n, 1);

// ---------------------------------------------------------------------------
console.log("\n共有部分 — 履歴の窓と入力の防御は移設しても同じ");
// ---------------------------------------------------------------------------

const rally = (i) => [
  { role: "user", text: `学生の発言 ${i}。${"あ".repeat(120)}` },
  { role: "ai", text: `AIの問い ${i}。${"い".repeat(150)}` },
];
const long = Array.from({ length: 30 }, (_, i) => rally(i + 1)).flat();

eq("30往復 → 直近12往復ぶんの24件に絞られる", historyWindow(long).length, 24);
check("最新の発言は必ず残る", historyWindow(long).at(-1).text === long.at(-1).text);
eq("配列でなければ空", parseMessages("nope").length, 0);
eq("空白だけの発言は落ちる", parseMessages([{ role: "user", text: "   " }]).length, 0);
eq("40件を超える履歴は切られる", parseMessages(long).length, 40);

console.log(`\n  info モデル: ${CHAT_MODEL}`);
console.log(
  failures === 0 ? "\n✅ すべて通りました\n" : `\n❌ ${failures} 件失敗しました\n`,
);
process.exit(failures === 0 ? 0 : 1);
