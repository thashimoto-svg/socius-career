/**
 * Offline checks for the guards added after the 「16ラリーで応答が止まる」 report.
 *
 * The failure was a Gemini free-tier quota (20 requests per project per day for
 * gemini-2.5-flash), which arrives as a 429 that is indistinguishable from the
 * per-minute quota unless the quotaId is read. The bodies asserted against below
 * are the real ones, captured from the API during that investigation.
 *
 * Runs without an API key and without spending quota — which is the point, since
 * the quota is the thing being defended against.
 *
 *   node --experimental-strip-types --import ./scripts/ts-resolve.mjs \
 *     scripts/check-gemini-guards.mjs
 */
import {
  callGemini,
  classifyGeminiFailure,
  historyWindow,
  HISTORY_RALLIES,
  isGeminiFailure,
  parseMessages,
} from "../lib/server/gemini.ts";

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
  check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// The real 429 bodies, as the SDK surfaces them: the upstream JSON is nested
// inside the SDK's own message as a string.
const apiError = (status, upstream) => ({
  name: "ApiError",
  status,
  message: JSON.stringify({ error: { message: JSON.stringify(upstream), code: status } }),
});

const DAILY_QUOTA = apiError(429, {
  error: {
    code: 429,
    message:
      "You exceeded your current quota. \n* Quota exceeded for metric: " +
      "generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, " +
      "model: gemini-2.5-flash\nPlease retry in 42.650005747s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "42s" },
    ],
  },
});

const MINUTE_QUOTA = apiError(429, {
  error: {
    code: 429,
    message:
      "You exceeded your current quota. \n* Quota exceeded for metric: " +
      "generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, " +
      "model: gemini-2.5-flash\nPlease retry in 35.250971954s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", quotaValue: "5" }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "35s" },
    ],
  },
});

const OVERLOADED = apiError(503, {
  error: {
    code: 503,
    message: "This model is currently experiencing high demand. Spikes in demand are usually temporary.",
    status: "UNAVAILABLE",
  },
});

const FORBIDDEN = apiError(403, {
  error: { code: 403, message: "API key not valid", status: "PERMISSION_DENIED" },
});

// ---------------------------------------------------------------------------
console.log("\nhistoryWindow — the sliding window sent to Gemini");
// ---------------------------------------------------------------------------

const rally = (i) => [
  { role: "user", text: `学生の発言 ${i}。${"あ".repeat(120)}` },
  { role: "ai", text: `AIの問い ${i}。${"い".repeat(150)}` },
];
const long = Array.from({ length: 30 }, (_, i) => rally(i + 1)).flat();

const windowed = historyWindow(long);
eq("30往復 → 直近12往復ぶんの24件に絞られる", windowed.length, HISTORY_RALLIES * 2);
check(
  "最新の発言は必ず残る",
  windowed.at(-1).text === long.at(-1).text,
  `window tail = ${windowed.at(-1)?.text.slice(0, 20)}`,
);
check(
  "落ちるのは古い側",
  windowed[0].text.includes("19") && !windowed.some((m) => m.text.includes("発言 1。")),
  `window head = ${windowed[0].text.slice(0, 20)}`,
);

const short = Array.from({ length: 3 }, (_, i) => rally(i + 1)).flat();
eq("12往復未満はそのまま全部送る", historyWindow(short).length, 6);
eq("空の履歴は空のまま(初回発話の経路)", historyWindow([]).length, 0);

// The per-message cap is 8,000 characters, so turn count alone is not a bound.
const fat = Array.from({ length: 12 }, () => [
  { role: "user", text: "う".repeat(8000) },
  { role: "ai", text: "え".repeat(8000) },
]).flat();
const fatWindow = historyWindow(fat);
const fatChars = fatWindow.reduce((n, m) => n + m.text.length, 0);
check(
  "極端に長い発言は文字数の上限で切られる",
  fatWindow.length < 24 && fatChars <= 24_000 + 8000,
  `${fatWindow.length} msgs / ${fatChars} chars`,
);
check("文字数で切っても最新の発言は残る", fatWindow.at(-1) === fat.at(-1));

const single = [{ role: "user", text: "お".repeat(30_000) }];
eq("単独で上限を超える発言も送る(答えないより良い)", historyWindow(single).length, 1);

// Rough size of what now goes out, for the record. Japanese runs about two
// characters per token against this model.
const chars = windowed.reduce((n, m) => n + m.text.length, 0);
console.log(
  `  info 30往復時点の送信量: ${windowed.length}件 / ${chars}字 ≈ ${Math.round(chars / 2)}トークン ` +
    `(+ システムプロンプト約500)`,
);

// ---------------------------------------------------------------------------
console.log("\nclassifyGeminiFailure — 429 の中身を読み分ける");
// ---------------------------------------------------------------------------

const daily = classifyGeminiFailure(DAILY_QUOTA);
eq("1日上限 → daily-quota", daily.kind, "daily-quota");
eq("1日上限 → 429", daily.status, 429);
eq("1日上限 → retryDelay を読む", daily.retryAfterSeconds, 42);
check(
  "1日上限のメッセージは「少し待って」と言わない",
  daily.message.includes("日付が変わると") && !daily.message.includes("少し待って"),
  daily.message,
);

const minute = classifyGeminiFailure(MINUTE_QUOTA);
eq("分あたり上限 → rate-limit", minute.kind, "rate-limit");
check("分あたり上限のメッセージは待てば直ると言う", minute.message.includes("少し待って"), minute.message);
check("同じ429でも別のメッセージになる", daily.message !== minute.message);

eq("503 → overloaded", classifyGeminiFailure(OVERLOADED).kind, "overloaded");
eq("503 → クライアントには503", classifyGeminiFailure(OVERLOADED).status, 503);
eq("403 → config(学生が待っても直らない)", classifyGeminiFailure(FORBIDDEN).kind, "config");
eq("キー未設定 → config", classifyGeminiFailure(new Error("GEMINI_API_KEY is not set.")).kind, "config");
eq("正体不明 → unknown/502", classifyGeminiFailure(new Error("boom")).status, 502);
check("分類結果は GeminiFailure として判定できる", isGeminiFailure(daily) && !isGeminiFailure(new Error("x")));

// ---------------------------------------------------------------------------
console.log("\ncallGemini — リトライするものとしないもの");
// ---------------------------------------------------------------------------

async function attempts(error, { succeedOnAttempt = Infinity } = {}) {
  let n = 0;
  const startedAt = Date.now();
  let thrown = null;
  try {
    await callGemini("check", async () => {
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
eq("503 が一度なら2回目で成功する", transient.n, 2);
check("成功したら例外は投げない", transient.thrown === null);

const persistent = await attempts(OVERLOADED);
eq("503 が続くなら合計3回(初回 + リトライ2回)で諦める", persistent.n, 3);
eq("諦めた後は overloaded として返す", persistent.thrown?.kind, "overloaded");
check("指数バックオフで待っている", persistent.ms >= 2_000, `${persistent.ms}ms`);
check("待ち時間には上限がある", persistent.ms < 6_000, `${persistent.ms}ms`);

const dailyRun = await attempts(DAILY_QUOTA);
eq("1日上限はリトライしない(翌日まで直らない)", dailyRun.n, 1);
eq("1日上限は daily-quota として返す", dailyRun.thrown?.kind, "daily-quota");
check("1日上限は待たずに即返す", dailyRun.ms < 500, `${dailyRun.ms}ms`);

// 35 秒待てと言われても、学生はスピナーを見ている。
const minuteRun = await attempts(MINUTE_QUOTA);
eq("分あたり上限は retryDelay が長すぎるので即返す", minuteRun.n, 1);
eq("分あたり上限は rate-limit として返す", minuteRun.thrown?.kind, "rate-limit");
check("35秒スピナーを回さない", minuteRun.ms < 500, `${minuteRun.ms}ms`);

const configRun = await attempts(FORBIDDEN);
eq("設定ミスはリトライしない", configRun.n, 1);

// ---------------------------------------------------------------------------
console.log("\nparseMessages — 受け取り側の防御は残っている");
// ---------------------------------------------------------------------------

eq("配列でなければ空", parseMessages("nope").length, 0);
eq("壊れた要素は落ちる", parseMessages([{ role: "user" }, { role: "user", text: "ok" }]).length, 1);
eq("空白だけの発言は落ちる", parseMessages([{ role: "user", text: "   " }]).length, 0);
eq("40件を超える履歴は切られる", parseMessages(long).length, 40);

console.log(
  failures === 0
    ? "\n✅ すべて通りました\n"
    : `\n❌ ${failures} 件失敗しました\n`,
);
process.exit(failures === 0 ? 0 : 1);
