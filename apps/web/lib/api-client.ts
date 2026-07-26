import type { User } from "firebase/auth";

/**
 * Calls to our own route handlers.
 *
 * Firebase Auth keeps its session in the client SDK rather than in cookies, so
 * a fetch carries no identity unless we attach one. Every call sends a fresh
 * ID token; `getIdToken()` returns the cached one until it is close to expiry,
 * so this is not a round trip per request.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function postJson<T>(path: string, user: User, body: unknown): Promise<T> {
  const token = await user.getIdToken();

  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const payload = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      payload?.error ?? "通信に失敗しました。時間をおいてもう一度お試しください。",
    );
  }

  return payload as T;
}
