"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import { AuthSplash } from "./auth-splash";
import { ScreenError } from "./screen-state";

/**
 * Client-side gate for the signed-in area.
 *
 * Firebase Auth keeps its session in the browser rather than in cookies, so
 * the server cannot know who the caller is at render time — the guard has to
 * live here. Firestore rules are the real access boundary; this only decides
 * what to render.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, blocked, retryAuth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Not knowing is not the same as being signed out, so a blocked gate must
    // not bounce a signed-in student to the login screen. It waits for 再試行.
    if (!loading && !blocked && !user) router.replace("/login");
  }, [loading, blocked, user, router]);

  if (blocked) {
    return <ScreenError message={blocked} onRetry={retryAuth} fill />;
  }

  if (loading || !user) return <AuthSplash />;

  return <>{children}</>;
}
