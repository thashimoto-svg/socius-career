import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Server-side verification of a Firebase ID token.
 *
 * The route handlers hold the Gemini API key, so they must not answer to
 * anyone who can reach the URL. Verification is done against Google's public
 * JWKS rather than through firebase-admin: checking a signature only needs
 * public keys, and pulling in the Admin SDK would mean provisioning a service
 * account this app has no other use for.
 */

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

// createRemoteJWKSet caches the key set and refetches on rotation, so this is
// a module-level singleton rather than a per-request fetch.
const JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

/** A verified caller: who they are, and the token that proved it. */
export type VerifiedCaller = { uid: string; idToken: string };

/**
 * Returns the caller, or null if the request is not a signed-in student.
 * Never throws — an unverifiable token is a 401, not a 500.
 *
 * The token comes back as well as the uid because the daily-usage counter is
 * read and written through the Firestore REST API on the student's own
 * authority (see lib/server/usage.ts). Keeping this route free of Firestore
 * credentials is the reason that works the way it does.
 */
export async function verifyRequest(request: Request): Promise<VerifiedCaller | null> {
  if (!PROJECT_ID) return null;

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
      algorithms: ["RS256"],
    });

    // Firebase puts the uid in `sub`.
    const uid = typeof payload.sub === "string" ? payload.sub : null;
    return uid && uid.length > 0 ? { uid, idToken: token } : null;
  } catch {
    return null;
  }
}

/** The uid alone, for the callers that have no use for the token. */
export async function verifyRequestUid(request: Request): Promise<string | null> {
  return (await verifyRequest(request))?.uid ?? null;
}

/**
 * A crude per-uid throttle.
 *
 * Process-local, so it is not a real quota — with more than one server
 * instance each keeps its own counter. It exists to stop a client bug from
 * looping on the API key, which is the failure mode that actually costs money
 * here. Real quotas belong in front of the deployment.
 */
const WINDOW_MS = 60_000;
const MAX_CALLS_PER_WINDOW = 20;
const calls = new Map<string, number[]>();

export function isRateLimited(uid: string): boolean {
  const now = Date.now();
  const recent = (calls.get(uid) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_CALLS_PER_WINDOW) {
    calls.set(uid, recent);
    return true;
  }

  recent.push(now);
  calls.set(uid, recent);
  return false;
}
