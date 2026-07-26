"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import { AuthSplash } from "./auth-splash";

/**
 * Client-side gate for the signed-in area.
 *
 * Firebase Auth keeps its session in the browser rather than in cookies, so
 * the server cannot know who the caller is at render time — the guard has to
 * live here. Firestore rules are the real access boundary; this only decides
 * what to render.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) return <AuthSplash />;

  return <>{children}</>;
}
