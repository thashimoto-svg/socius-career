/**
 * The cacheable prefix of each route, measured in the shape it is actually sent.
 *
 * Render order is tools → system → messages, and a breakpoint on the last
 * system block caches tools and system together. So what matters is not "how
 * big is the system prompt" but "how big is everything up to the breakpoint" —
 * which for /api/extract includes two tool schemas that are invisible in the
 * prompt files.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  buildChatSystemPrompt,
  EPISODE_TOOL_INPUT_SCHEMA,
  EPISODE_TOOL_NAME,
  EXTRACTION_SYSTEM_PROMPT,
  INVARIANT_CORE,
  profileBlock,
  SKIP_TOOL_INPUT_SCHEMA,
  SKIP_TOOL_NAME,
  TONES,
} from "../prompts/index.ts";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CHAT_MODEL || "claude-sonnet-4-6";
const MINIMUM = 1024; // claude-sonnet-4-6's minimum cacheable prefix

const EPISODE_TOOL = {
  name: EPISODE_TOOL_NAME,
  description:
    "壁打ちのログから抽出した、学生本人の言葉によるエピソードを1件保存する。",
  input_schema: EPISODE_TOOL_INPUT_SCHEMA,
};
const SKIP_TOOL = {
  name: SKIP_TOOL_NAME,
  description:
    "まだ保存できる新しいエピソードが無いときに呼ぶ。無理にエピソードを作らないこと。",
  input_schema: SKIP_TOOL_INPUT_SCHEMA,
};

/** One near-empty request, to subtract the fixed per-request envelope. */
async function floor() {
  const res = await client.messages.countTokens({
    model: MODEL,
    messages: [{ role: "user", content: "." }],
  });
  return res.input_tokens;
}

async function prefix(label, { system, tools }) {
  const res = await client.messages.countTokens({
    model: MODEL,
    ...(system ? { system } : {}),
    ...(tools ? { tools } : {}),
    messages: [{ role: "user", content: "." }],
  });
  const net = res.input_tokens - BASE;
  const verdict = net >= MINIMUM ? "✅ cacheable" : `❌ UNDER ${MINIMUM} — will NOT cache`;
  console.log(`${String(net).padStart(6)}  ${label.padEnd(46)} ${verdict}`);
  return net;
}

const BASE = await floor();
console.log(`model: ${MODEL}   minimum cacheable prefix: ${MINIMUM} tokens`);
console.log(`(envelope of ${BASE} tokens subtracted throughout)\n`);

const PROFILE = {
  grade: "大学3年",
  club: "アルバイト",
  industries: ["人材", "IT・ソフトウェア", "コンサルティング"],
};

console.log("=== /api/chat — system prompt ===");
await prefix("whole system prompt, as sent today", {
  system: buildChatSystemPrompt({ profile: PROFILE, mode: "counselor", theme: "アルバイトの経験" }),
});
await prefix("  …with no profile (pre-onboarding)", {
  system: buildChatSystemPrompt({ profile: null, mode: "counselor", theme: "" }),
});
await prefix("  …karakuchi tone", {
  system: buildChatSystemPrompt({ profile: PROFILE, mode: "karakuchi", theme: "アルバイトの経験" }),
});

console.log("\n--- candidate breakpoint 1: 深掘り層 + トーン層 (shared by every student) ---");
await prefix("INVARIANT_CORE + TONES.counselor", {
  system: `${INVARIANT_CORE}\n\n${TONES.counselor.instruction}`,
});
await prefix("INVARIANT_CORE + TONES.karakuchi", {
  system: `${INVARIANT_CORE}\n\n${TONES.karakuchi.instruction}`,
});
await prefix("INVARIANT_CORE alone", { system: INVARIANT_CORE });

console.log("\n--- what sits after that breakpoint (billed fresh) ---");
await prefix("profileBlock + theme", {
  system: `${profileBlock(PROFILE)}\n\nアルバイトの経験`,
});

console.log("\n=== /api/extract — tools render BEFORE system ===");
await prefix("EXTRACTION_SYSTEM_PROMPT alone", { system: EXTRACTION_SYSTEM_PROMPT });
await prefix("the two tool schemas alone", { tools: [EPISODE_TOOL, SKIP_TOOL] });
await prefix("tools + system (the real cacheable prefix)", {
  system: EXTRACTION_SYSTEM_PROMPT,
  tools: [EPISODE_TOOL, SKIP_TOOL],
});
