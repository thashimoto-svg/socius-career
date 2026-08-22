/**
 * Offline checks for firestore.rules — the two places where a rule is the whole
 * access boundary rather than a backstop behind a trusted server.
 *
 * That document is the one place where an access-control decision and a cost
 * decision meet. It holds two counters written by two different code paths for
 * two different reasons: the message cap, which the server judges *before* a
 * turn runs and PATCHes, and the day's token spend, which is only known after
 * the model stops and arrives through `increment` transforms. Both are written
 * with the student's own ID token, because the route handlers hold no Firestore
 * credentials — so these rules are the entire access boundary, not a backstop
 * behind a trusted server.
 *
 * The properties being defended, in order of how much they would cost to lose:
 *
 *   1. A student cannot get their message budget back. Spending it faster is
 *      fine and uninteresting; clearing it is the only attack that matters.
 *   2. A student cannot lower a token counter, i.e. cannot hide what they cost.
 *   3. Nobody can read or write anybody else's usage.
 *
 * Written after a real bug: the rules named `count` directly, which made the
 * day's first *token* write an evaluation error rather than a zero — see
 * 「count が無いドキュメント」 below. Nothing else in the codebase would have
 * caught it, because it fails soft: the write 403s, the .catch logs it, the
 * conversation carries on, and the opening line's tokens quietly never appear.
 *
 *   npm run check:rules      (starts the Firestore emulator; needs Java)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, increment, setDoc, updateDoc } from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const RULES = path.resolve(here, "../../../firestore.rules");

const env = await initializeTestEnvironment({
  projectId: "socius-rules-check",
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: fs.readFileSync(RULES, "utf8"),
  },
});

const ME = "student-a";
const OTHER = "student-b";
const DAY = "2026-08-12";
const usagePath = (uid = ME) => `users/${uid}/usage/${DAY}`;
const SESSION = "session-1";
const msgPath = (id, uid = ME) => `users/${uid}/sessions/${SESSION}/messages/${id}`;
const sessionPath = (uid = ME) => `users/${uid}/sessions/${SESSION}`;

/** A sheet the rules should accept, as the server writes it. */
const SHEET = {
  phase: "深掘り",
  episode: "居酒屋のホールでの2年間",
  situation: "大学2年、週4回のホール",
  task: "忙しい時間帯に注文が詰まっていた",
  action: "ドリンク担当を固定する案を出した",
  result: "提供時間が半分になった",
  learning: "やってみせるのが早いと分かった",
  motive: "困っている人がそのままなのが落ち着かない",
  facts: ["ドリンク提供時間が半分に", "週4回のシフト"],
  pending: ["高校の部活の話"],
};

const messagePath = (uid = ME, messageId = "message-1") =>
  `users/${uid}/sessions/${SESSION}/messages/${messageId}`;
const episodePath = (uid = ME) => `users/${uid}/episodes/episode-1`;

let failures = 0;

async function ok(name, promise) {
  try {
    await promise();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`  FAIL ${name} — ${String(e.message).split("\n")[0]}`);
  }
}

const mine = () => env.authenticatedContext(ME).firestore();
const theirs = () => env.authenticatedContext(OTHER).firestore();

/** Put documents in place without going through the rules. */
async function seedAt(entries) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const [path, data] of entries) {
      await setDoc(doc(ctx.firestore(), path), data);
    }
  });
}

async function seed(data) {
  await seedAt([[usagePath(), data]]);
}

async function fresh(data) {
  await env.clearFirestore();
  if (data) await seed(data);
}

/** Put a 壁打ち in place without going through the rules. */
async function seedSession(data = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), sessionPath()), {
      title: "居酒屋の話",
      theme: "アルバイトの経験",
      mode: "counselor",
      status: "open",
      turnCount: 4,
      episodeCount: 0,
      extractedCount: 0,
      progress: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    });
  });
}

/** Put a transcript line in place without going through the rules. */
async function seedMessage(id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), msgPath(id)), {
      mode: null,
      createdAt: new Date(),
      ...data,
    });
  });
}

// ---------------------------------------------------------------------------
console.log("\n作成 — 一日の最初の書き込みは2種類ある");
// ---------------------------------------------------------------------------

await fresh();
await ok("count=1 で作れる(数えられるターン)", () =>
  assertSucceeds(setDoc(doc(mine(), usagePath()), { count: 1, updatedAt: new Date() })),
);

await fresh();
await ok("count=0 で作れる(トークンだけが先に来る経路)", () =>
  assertSucceeds(setDoc(doc(mine(), usagePath()), { count: 0, updatedAt: new Date() })),
);

// The bug this file was written for. 壁打ちの最初の一言は課金対象外なので
// count を進めないが、トークンは使う。つまりその日の最初の書き込みが
// count を持たないことがある。ルールが count を直接名指しすると、
// 「Property count is undefined」で評価エラーになり拒否される。
await fresh();
await ok("count を持たない increment でも作れる(初回発話のトークン)", () =>
  assertSucceeds(
    setDoc(
      doc(mine(), usagePath()),
      { inputTokens: increment(200), outputTokens: increment(50), updatedAt: new Date() },
      { merge: true },
    ),
  ),
);

await fresh();
await ok("count=5 では作れない(枠を飛ばして始められない)", () =>
  assertFails(setDoc(doc(mine(), usagePath()), { count: 5, updatedAt: new Date() })),
);

await fresh();
await ok("知らないフィールドは作れない", () =>
  assertFails(
    setDoc(doc(mine(), usagePath()), { count: 1, evil: true, updatedAt: new Date() }),
  ),
);

// ---------------------------------------------------------------------------
console.log("\nメッセージ上限 — 取り戻せないこと");
// ---------------------------------------------------------------------------

await fresh({ count: 5, updatedAt: new Date() });
await ok("+1 は通る", () => assertSucceeds(updateDoc(doc(mine(), usagePath()), { count: 6 })));

await fresh({ count: 5, updatedAt: new Date() });
await ok("+2 は弾かれる(競合した2通目は捨てる)", () =>
  assertFails(updateDoc(doc(mine(), usagePath()), { count: 7 })),
);

await fresh({ count: 5, updatedAt: new Date() });
await ok("巻き戻しは弾かれる", () =>
  assertFails(updateDoc(doc(mine(), usagePath()), { count: 4 })),
);

await fresh({ count: 5, updatedAt: new Date() });
await ok("削除できない", () => assertFails(deleteDoc(doc(mine(), usagePath()))));

// ---------------------------------------------------------------------------
console.log("\nトークン — 足せるが引けない、そして count とは混ざらない");
// ---------------------------------------------------------------------------

await fresh({ count: 3, updatedAt: new Date() });
await ok("count 据え置きで4種類を足せる", () =>
  assertSucceeds(
    updateDoc(doc(mine(), usagePath()), {
      inputTokens: increment(500),
      outputTokens: increment(120),
      cacheWriteTokens: increment(1403),
      cacheReadTokens: increment(0),
      updatedAt: new Date(),
    }),
  ),
);

await fresh({ count: 3, inputTokens: 900, outputTokens: 200, updatedAt: new Date() });
await ok("トークンを減らすのは弾かれる(コストを隠せない)", () =>
  assertFails(updateDoc(doc(mine(), usagePath()), { inputTokens: 100 })),
);

// The two writes must stay separable, or the exactly-one-more rule the cap
// depends on would have to be relaxed to accommodate them.
await fresh({ count: 3, inputTokens: 900, outputTokens: 200, updatedAt: new Date() });
await ok("count とトークンを同時に動かすのは弾かれる", () =>
  assertFails(
    updateDoc(doc(mine(), usagePath()), { count: 4, inputTokens: increment(50) }),
  ),
);

await fresh({ count: 3, inputTokens: 900, updatedAt: new Date() });
await ok("ターンの書き込みはトークンに触れない限り通る", () =>
  assertSucceeds(updateDoc(doc(mine(), usagePath()), { count: 4, updatedAt: new Date() })),
);

// ---------------------------------------------------------------------------
console.log("\n所有権 — 「本人以外は読めません」");
// ---------------------------------------------------------------------------

await fresh({ count: 1, updatedAt: new Date() });
await ok("本人は読める", () => assertSucceeds(getDoc(doc(mine(), usagePath()))));
await ok("他人は読めない", () => assertFails(getDoc(doc(theirs(), usagePath(ME)))));
await ok("他人は書けない", () =>
  assertFails(updateDoc(doc(theirs(), usagePath(ME)), { count: 2 })),
);
await ok("他人のトークンも足せない", () =>
  assertFails(
    updateDoc(doc(theirs(), usagePath(ME)), { inputTokens: increment(1), updatedAt: new Date() }),
  ),
);

// ---------------------------------------------------------------------------
console.log("\n壁打ちの削除 — 消せるのは自分のものだけ");
// ---------------------------------------------------------------------------

/**
 * A 壁打ち with a transcript, and an episode extracted from it — for both
 * students, so that every 「他人の」 case below has something real to fail
 * against rather than passing because the document was never there.
 */
async function freshSessions() {
  await env.clearFirestore();
  const tree = (uid) => [
    [
      sessionPath(uid),
      {
        title: "面接で話せる話がない",
        theme: "",
        mode: "counselor",
        status: "open",
        turnCount: 4,
        episodeCount: 1,
        extractedCount: 4,
      },
    ],
    [messagePath(uid), { role: "user", text: "部活の話ならできます" }],
    [
      episodePath(uid),
      {
        title: "集合時間を10分前倒しにした提案",
        tag: "リーダーシップ",
        period: "大学2年",
        emotion: "焦り",
        star: { S: "", T: "", A: "", R: "" },
        learn: "",
        // Deliberately pointing at the session deleted below: the episode has
        // to survive it, and the 自分史 hides its link rather than the card
        // being rewritten or dropped.
        sessionId: SESSION,
      },
    ],
  ];
  await seedAt([...tree(ME), ...tree(OTHER)]);
}

await freshSessions();
await ok("本人は自分の壁打ちを削除できる", () =>
  assertSucceeds(deleteDoc(doc(mine(), sessionPath()))),
);

await freshSessions();
await ok("本人は自分のメッセージを削除できる(本体より先に消す経路)", () =>
  assertSucceeds(deleteDoc(doc(mine(), messagePath()))),
);

await freshSessions();
await ok("他人の壁打ちは削除できない", () =>
  assertFails(deleteDoc(doc(theirs(), sessionPath(ME)))),
);

await freshSessions();
await ok("他人のメッセージは削除できない", () =>
  assertFails(deleteDoc(doc(theirs(), messagePath(ME)))),
);

await freshSessions();
await ok("他人は壁打ちを読めない", () => assertFails(getDoc(doc(theirs(), sessionPath(ME)))));

// 壁打ちを消してもエピソードは残る、というのはアプリ側の約束であってルールの
// 効果ではない (ルールは cascade しないので、消しに行かない限り残る)。ここで
// 見ているのは、その約束の逆側 — エピソードの削除権限が本人だけのまま
// 変わっていないこと。
await freshSessions();
await ok("本人は自分のエピソードを削除できる(既存のまま)", () =>
  assertSucceeds(deleteDoc(doc(mine(), episodePath()))),
);

await freshSessions();
await ok("他人のエピソードは削除できない", () =>
  assertFails(deleteDoc(doc(theirs(), episodePath(ME)))),
);

console.log("\n本文の訂正 — 直せるのは自分の言葉だけ");
// ---------------------------------------------------------------------------

/*
  The transcript is the evidence the 自分史 is extracted from, and it was
  append-only for that reason. Letting the student fix their own typo (β報告
  8/18) opens exactly one hole in that, and everything below is about how far
  the hole goes: their own turns, their own words, and never silently.
*/

await fresh();
await seedMessage("m1", { role: "user", text: "部活でリーダーをやってました" });
await ok("自分の発言は直せる", () =>
  assertSucceeds(
    updateDoc(doc(mine(), msgPath("m1")), { text: "部活で副キャプテンをやってました", editedAt: new Date() }),
  ),
);

await fresh();
await ok("選択肢つきのAI発言を書ける", () =>
  assertSucceeds(
    setDoc(doc(mine(), msgPath("m3")), {
      role: "ai",
      text: "どちらの話から聞かせてもらえますか",
      mode: "counselor",
      choices: ["部活の話", "アルバイトの話"],
      createdAt: new Date(),
    }),
  ),
);

await fresh();
await ok("選択肢が5つは弾かれる", () =>
  assertFails(
    setDoc(doc(mine(), msgPath("m3")), {
      role: "ai",
      text: "どれですか",
      mode: "counselor",
      choices: ["1", "2", "3", "4", "5"],
      createdAt: new Date(),
    }),
  ),
);

await fresh();
await seedMessage("m1", { role: "user", text: "部活でリーダーをやってました" });
await ok("editedAt 無しでは直せない(黙って書き換えられない)", () =>
  assertFails(updateDoc(doc(mine(), msgPath("m1")), { text: "書き換え" })),
);

await fresh();
await seedMessage("m2", { role: "ai", text: "どんな部活でしたか?", mode: "counselor" });
await ok("AIの発言は直せない(言われたことの記録)", () =>
  assertFails(
    updateDoc(doc(mine(), msgPath("m2")), { text: "でっちあげ", editedAt: new Date() }),
  ),
);

await fresh();
await seedMessage("m1", { role: "user", text: "部活の話" });
await ok("role は変えられない(自分の発言をAIの発言にできない)", () =>
  assertFails(
    updateDoc(doc(mine(), msgPath("m1")), { role: "ai", text: "AIが言ったこと", editedAt: new Date() }),
  ),
);

await fresh();
await seedMessage("m1", { role: "user", text: "部活の話" });
await ok("createdAt は変えられない(並び順は動かせない)", () =>
  assertFails(
    updateDoc(doc(mine(), msgPath("m1")), { createdAt: new Date(2020, 0, 1), editedAt: new Date() }),
  ),
);

await fresh();
await seedMessage("m1", { role: "user", text: "部活の話" });
await ok("空文字にはできない", () =>
  assertFails(updateDoc(doc(mine(), msgPath("m1")), { text: "", editedAt: new Date() })),
);

await fresh();
await seedMessage("m1", { role: "user", text: "部活の話" });
await ok("8000字を超えては書けない", () =>
  assertFails(
    updateDoc(doc(mine(), msgPath("m1")), { text: "あ".repeat(8001), editedAt: new Date() }),
  ),
);

await fresh();
await seedMessage("m1", { role: "user", text: "部活の話" });
await ok("知らないフィールドは足せない", () =>
  assertFails(
    updateDoc(doc(mine(), msgPath("m1")), { text: "直した", editedAt: new Date(), evil: true }),
  ),
);

await fresh();
await seedMessage("m1", { role: "user", text: "部活の話" });
await ok("他人の発言は直せない", () =>
  assertFails(
    updateDoc(doc(theirs(), msgPath("m1", ME)), { text: "横取り", editedAt: new Date() }),
  ),
);

await fresh();
await seedMessage("m1", { role: "user", text: "部活の話" });
await ok("自分の発言は消せる", () => assertSucceeds(deleteDoc(doc(mine(), msgPath("m1")))));

await fresh();
await seedMessage("m2", { role: "ai", text: "どんな部活でしたか?" });
await ok("直後のAI応答も消せる(発言と応答は対で消える)", () =>
  assertSucceeds(deleteDoc(doc(mine(), msgPath("m2")))),
);

// ---------------------------------------------------------------------------
console.log("\nエピソードシート — 二人が書く一枚");
// ---------------------------------------------------------------------------

/*
  この欄はサーバー(app/api/chat が学生自身のIDトークンで REST 経由)と学生本人の
  両方が書く。片方だけを信じられる経路が無いので、形の保証はルールにしかない。
  中身は検閲しない——学生が話した内容がそのまま入る欄で、書ける値を絞る意味が
  ないため。効いてほしいのは、見知らぬキーが増えないことと、青天井に伸びないこと。
*/

await fresh();
await seedSession();
await ok("シートを書ける", () =>
  assertSucceeds(updateDoc(doc(mine(), sessionPath()), { worksheet: SHEET, progress: ["situation"] })),
);

await fresh();
await seedSession();
await ok("知らないキーは弾かれる", () =>
  assertFails(
    updateDoc(doc(mine(), sessionPath()), { worksheet: { ...SHEET, evil: "true" } }),
  ),
);

await fresh();
await seedSession();
await ok("1000字を超える欄は弾かれる", () =>
  assertFails(
    updateDoc(doc(mine(), sessionPath()), {
      worksheet: { ...SHEET, situation: "あ".repeat(1001) },
    }),
  ),
);

await fresh();
await seedSession();
await ok("未回収メモが7件は弾かれる", () =>
  assertFails(
    updateDoc(doc(mine(), sessionPath()), {
      worksheet: { ...SHEET, pending: ["1", "2", "3", "4", "5", "6", "7"] },
    }),
  ),
);

await fresh();
await seedSession();
await ok("具体が13件は弾かれる", () =>
  assertFails(
    updateDoc(doc(mine(), sessionPath()), {
      worksheet: { ...SHEET, facts: Array.from({ length: 13 }, (_, i) => `事実${i}`) },
    }),
  ),
);

await fresh();
await seedSession();
await ok("シートがマップでないのは弾かれる", () =>
  assertFails(updateDoc(doc(mine(), sessionPath()), { worksheet: "まるごと文字列" })),
);

await fresh();
await seedSession();
await ok("欄が文字列でないのは弾かれる", () =>
  assertFails(
    updateDoc(doc(mine(), sessionPath()), { worksheet: { ...SHEET, episode: 7 } }),
  ),
);

// シート以前の壁打ちは worksheet を持たない。持たないまま書き続けられること。
await fresh();
await seedSession();
await ok("シートに触れない更新は通る(シート以前の壁打ち)", () =>
  assertSucceeds(updateDoc(doc(mine(), sessionPath()), { title: "名前を変えた" })),
);

await fresh();
await seedSession();
await ok("他人のシートは書けない", () =>
  assertFails(updateDoc(doc(theirs(), sessionPath(ME)), { worksheet: SHEET })),
);

await env.cleanup();

console.log(
  failures === 0 ? "\n✅ すべて通りました" : `\n❌ ${failures} 件失敗しました`,
);
process.exit(failures === 0 ? 0 : 1);
