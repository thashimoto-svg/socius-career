"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import { AuthSplash } from "@/components/auth-splash";
import { ScreenError } from "@/components/screen-state";

// Entry point. Signed-out students go to /login, first-timers to /onboarding,
// and anyone who has already answered the survey to /home — which is where
// they can see what the 壁打ち has added up to before deciding to add to it.
export default function Home() {
  const { user, userDoc, loading, blocked, retryAuth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // The profile is what this decision is made of. Guessing at it would send
    // a student who has already finished onboarding through it a second time,
    // so a gate that could not answer waits for 再試行 instead of routing.
    if (blocked) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    router.replace(userDoc?.onboardingCompleted ? "/home" : "/onboarding");
  }, [user, userDoc, loading, blocked, router]);

  if (blocked) {
    return <ScreenError message={blocked} onRetry={retryAuth} fill />;
  }

  return <AuthSplash />;
}
