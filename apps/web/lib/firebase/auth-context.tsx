"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "./client";
import { ensureUserDoc } from "./users";
import type { OnboardingProfile, UserDoc } from "./schema";

type AuthValue = {
  user: User | null;
  /**
   * The student's `users/{uid}` document. Loaded alongside the session so that
   * routing decisions ("has this person finished onboarding?") don't need a
   * second loading state on every screen.
   */
  userDoc: UserDoc | null;
  /** True until Firebase has restored (or ruled out) a persisted session. */
  loading: boolean;
  /** Set when the last sign-in attempt failed, for display to the student. */
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Reflect a just-saved onboarding answer without a round trip. */
  applyOnboarding: (profile: OnboardingProfile) => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Signing out right after signing in would otherwise let the slower user-doc
  // fetch land last and resurrect a signed-out student's profile.
  const generation = useRef(0);

  useEffect(() => {
    // Firebase reads the persisted session from IndexedDB asynchronously, so
    // the first callback is what tells us whether anyone is actually signed in.
    return onAuthStateChanged(getFirebaseAuth(), (next) => {
      const gen = ++generation.current;
      setUser(next);

      if (!next) {
        setUserDoc(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      ensureUserDoc(next)
        .then((doc) => {
          if (gen !== generation.current) return;
          setUserDoc(doc);
        })
        .catch(() => {
          if (gen !== generation.current) return;
          setUserDoc(null);
          setError(
            "プロフィールを読み込めませんでした。通信状況を確認して、ページを再読み込みしてください。",
          );
        })
        .finally(() => {
          if (gen !== generation.current) return;
          setLoading(false);
        });
    });
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    try {
      await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      // Closing the popup is a normal thing to do, not an error worth showing.
      if (
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request"
      ) {
        return;
      }
      setError(
        code === "auth/popup-blocked"
          ? "ポップアップがブロックされました。ブラウザの設定を確認してください。"
          : "サインインできませんでした。時間をおいてもう一度お試しください。",
      );
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(getFirebaseAuth());
  }, []);

  const applyOnboarding = useCallback((profile: OnboardingProfile) => {
    setUserDoc((prev) =>
      prev ? { ...prev, profile, onboardingCompleted: true } : prev,
    );
  }, []);

  const value = useMemo(
    () => ({
      user,
      userDoc,
      loading,
      error,
      signInWithGoogle,
      signOut,
      applyOnboarding,
    }),
    [user, userDoc, loading, error, signInWithGoogle, signOut, applyOnboarding],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
