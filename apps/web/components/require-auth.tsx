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
 *
 * What it waits for is the session and nothing else. The profile read used to
 * be behind the same flag, which meant every screen sat on 「読み込んでいます…」
 * through two round trips laid end to end — the second one for a document that
 * only decides whose name to print. Now the gate opens on the uid, the screen
 * mounts and asks for its own data, and the profile lands in parallel.
 */
export function RequireAuth({
  children,
  /**
   * For the screens whose content is made of the profile rather than merely
   * decorated by it: onboarding prefills its chips from the saved answers, and
   * a chip that renders before they arrive keeps the default forever. Those
   * screens pay the extra wait on purpose.
   */
  waitForProfile = false,
}: {
  children: React.ReactNode;
  waitForProfile?: boolean;
}) {
  const { user, sessionLoading, profileLoading, blocked, profileError, retryAuth } =
    useAuth();
  const router = useRouter();

  useEffect(() => {
    // Not knowing is not the same as being signed out, so a blocked gate must
    // not bounce a signed-in student to the login screen. It waits for 再試行.
    if (!sessionLoading && !blocked && !user) router.replace("/login");
  }, [sessionLoading, blocked, user, router]);

  if (blocked) {
    return <ScreenError message={blocked} onRetry={retryAuth} fill />;
  }

  if (sessionLoading || !user) return <AuthSplash />;

  if (waitForProfile) {
    if (profileError) {
      return <ScreenError message={profileError} onRetry={retryAuth} fill />;
    }
    if (profileLoading) return <AuthSplash />;
  }

  return <>{children}</>;
}
