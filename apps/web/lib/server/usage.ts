/**
 * The per-student daily message cap.
 *
 * Counted at users/{uid}/usage/{YYYY-MM-DD}, judged here, on the server.
 *
 * Reached through the Firestore REST API carrying the student's own ID token
 * rather than through firebase-admin. The route handlers hold no Firestore
 * credentials by design — verifying the token already proves who the caller is,
 * and adding a service account would give this app's server the run of every
 * student's document tree to count to fifty. With the student's token the
 * server can only touch what the student could, and firestore.rules is what
 * makes that safe: the usage counter is create-at-1, then increment-by-one, and
 * nothing may delete it. A student can inflate their own count. They cannot
 * clear it, which is the only attack that would matter.
 */

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

/** 「本日の上限」 — overridable per deployment, 50 when unset. */
export const DAILY_MESSAGE_LIMIT = (() => {
  const raw = Number(process.env.DAILY_MESSAGE_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50;
})();

export const DAILY_LIMIT_MESSAGE = "本日の上限に達しました。明日また続けましょう。";

/**
 * Which day it is, for a student in Japan.
 *
 * Not UTC. 「明日また続けましょう」 has to mean tomorrow to the person reading it,
 * and a cap that resets at 9am local would be a different promise.
 */
export function usageDay(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is the shape the document id needs.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function documentUrl(uid: string, day: string): string {
  return (
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/users/${uid}/usage/${day}`
  );
}

/** How many messages have been sent today. A missing document means none. */
export async function readUsage(
  uid: string,
  idToken: string,
  day: string,
): Promise<number> {
  const res = await fetch(documentUrl(uid, day), {
    headers: { authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });

  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`usage read failed: ${res.status}`);

  const body = (await res.json()) as {
    fields?: { count?: { integerValue?: string } };
  };
  const count = Number(body.fields?.count?.integerValue);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

/**
 * Record one more message.
 *
 * `next` is passed in rather than incremented here so the value written is the
 * one the limit was judged against. The rules only accept exactly one more than
 * what is stored, so a racing second request is rejected rather than silently
 * overwriting — which is the right outcome: the count stays honest, and losing
 * one tick of a fifty-message budget is not worth a transaction.
 */
export async function writeUsage(
  uid: string,
  idToken: string,
  day: string,
  next: number,
): Promise<void> {
  const url =
    `${documentUrl(uid, day)}?updateMask.fieldPaths=count` +
    `&updateMask.fieldPaths=updatedAt`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        count: { integerValue: String(next) },
        updatedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });

  if (!res.ok) throw new Error(`usage write failed: ${res.status}`);
}

export type UsageVerdict = {
  /** False when the student has hit the cap and this turn must not run. */
  allowed: boolean;
  /** What to store once the turn has actually happened. */
  next: number;
};

/**
 * Decide whether this turn is within today's budget.
 *
 * Fails open. If the counter cannot be read, the student gets their answer:
 * a limit exists to bound cost, and refusing to talk to someone because a
 * counter was unreachable spends the app's credibility to save a fraction of
 * a cent.
 */
export async function checkDailyLimit(
  uid: string,
  idToken: string,
  day: string,
): Promise<UsageVerdict> {
  try {
    const used = await readUsage(uid, idToken, day);
    return { allowed: used < DAILY_MESSAGE_LIMIT, next: used + 1 };
  } catch (e) {
    console.error("[usage] could not read today's count; allowing the turn", e);
    return { allowed: true, next: 0 };
  }
}
