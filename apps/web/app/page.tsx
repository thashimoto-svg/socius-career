"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import { AuthSplash } from "@/components/auth-splash";

// Entry point. Signed-out students go to /login, first-timers to /onboarding,
// and anyone who has already answered the survey straight into the 壁打ち.
export default function Home() {
  const { user, userDoc, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    // A missing user document means the profile fetch failed; sending them
    // through onboarding again is the recoverable choice.
    router.replace(userDoc?.onboardingCompleted ? "/chat" : "/onboarding");
  }, [user, userDoc, loading, router]);

  return <AuthSplash />;
}
