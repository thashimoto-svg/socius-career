"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import { AuthSplash } from "@/components/auth-splash";

// Entry point. Signed-out students go to /login, first-timers to /onboarding.
// TODO(firebase): Phase 5 reads users/{uid}.onboardingCompleted here and sends
// returning students straight to /chat instead.
export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/onboarding" : "/login");
  }, [user, loading, router]);

  return <AuthSplash />;
}
