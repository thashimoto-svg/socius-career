"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import { AuthSplash } from "@/components/auth-splash";
import { ScreenError } from "@/components/screen-state";
import { HOME_SCOPE, loadHomeSummary } from "@/lib/home-summary";
import { warmLoadable } from "@/lib/use-loadable";

// Entry point. Signed-out students go to /login, first-timers to /onboarding,
// and anyone who has already answered the survey to /home — which is where
// they can see what the 壁打ち has added up to before deciding to add to it.
export default function Home() {
  const { user, userDoc, sessionLoading, profileLoading, blocked, profileError, retryAuth } =
    useAuth();
  const router = useRouter();

  // The decision below needs the profile; ホーム's own data does not. So it is
  // asked for the moment there is a uid to ask with, and by the time the
  // redirect lands the answer is usually already there. Three round trips in a
  // row become two, on the path almost everyone takes into the app.
  useEffect(() => {
    if (!user) return;
    warmLoadable(user.uid, HOME_SCOPE, loadHomeSummary);
  }, [user]);

  useEffect(() => {
    if (sessionLoading || profileLoading) return;
    // The profile is what this decision is made of. Guessing at it would send
    // a student who has already finished onboarding through it a second time,
    // so a gate that could not answer waits for 再試行 instead of routing.
    if (blocked || profileError) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    router.replace(userDoc?.onboardingCompleted ? "/home" : "/onboarding");
  }, [user, userDoc, sessionLoading, profileLoading, blocked, profileError, router]);

  const failure = blocked ?? profileError;
  if (failure) {
    return <ScreenError message={failure} onRetry={retryAuth} fill />;
  }

  return <AuthSplash />;
}
