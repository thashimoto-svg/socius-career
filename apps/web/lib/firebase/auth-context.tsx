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
import { mark } from "../perf";
import { LOAD_TIMEOUT_MS, withTimeout } from "../with-timeout";
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
  /**
   * Set when the gate itself failed — the session could not be restored, or the
   * profile behind it could not be read. Distinct from `error`, which is about
   * a sign-in the student just attempted: this is about the app being unable to
   * say who they are, which is what every screen is waiting on.
   */
  blocked: string | null;
  /** Try the gate again. What the 再試行 button on the splash calls. */
  retryAuth: () => void;
  /**
   * `agreedToTerms` records the consent the login screen's checkbox gates the
   * button on, so the fact is stored against the account that gave it.
   */
  signInWithGoogle: (agreedToTerms: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  /** Reflect a just-saved onboarding answer without a round trip. */
  applyOnboarding: (profile: OnboardingProfile) => void;
};

const AuthContext = createContext<AuthValue | null>(null);

/**
 * What to tell the student when sign-in fails.
 *
 * Split by whose problem it is. 「時間をおいてもう一度お試しください」 is the right
 * sentence for a flaky connection and a lie for a misconfigured project: it
 * asks someone to keep pressing a button that cannot work, and it hides the one
 * fact that would fix it from the only person reading the screen. An error
 * nobody can act on should at least name itself.
 */
function signInMessage(code: string): string {
  switch (code) {
    // The deployment is being served from a hostname Firebase Auth was never
    // told about — a preview URL, a new Codespace, a port that drifted. The
    // hostname is in the message because it is the exact string that has to be
    // pasted into 承認済みドメイン.
    case "auth/unauthorized-domain": {
      const host =
        typeof window === "undefined" ? "(不明)" : window.location.hostname;
      return (
        `このドメインからはサインインできません(開発環境設定の問題です)。\n` +
        `Firebase Console → Authentication → Settings → 承認済みドメイン に ` +
        `${host} を追加してください。`
      );
    }

    // The provider is switched off in the console. Same class: nothing the
    // student does will change it.
    case "auth/operation-not-allowed":
      return "Google サインインが有効になっていません(開発環境設定の問題です)。";

    case "auth/popup-blocked":
      return "ポップアップがブロックされました。ブラウザの設定を確認してください。";

    // This one really is worth another go.
    case "auth/network-request-failed":
      return "通信に失敗しました。通信状況を確認して、もう一度お試しください。";

    default:
      return "サインインできませんでした。時間をおいてもう一度お試しください。";
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Signing out right after signing in would otherwise let the slower user-doc
  // fetch land last and resurrect a signed-out student's profile.
  const generation = useRef(0);

  // Consent belongs to the sign-in the student just performed, not to a session
  // Firebase restored from IndexedDB on page load — those must not stamp one.
  const pendingConsent = useRef(false);

  useEffect(() => {
    setBlocked(null);
    setLoading(true);

    /**
     * The deadline on the gate itself.
     *
     * Every screen's own load has had one since the 壁打ち bug, but all of them
     * sit behind this: RequireAuth renders 「読み込んでいます…」 while `loading`,
     * and `loading` only ever cleared inside the callback below. Firebase reads
     * the persisted session out of IndexedDB, and that read does not always come
     * back — storage blocked, a private window, an embedded webview. When it
     * doesn't, the callback never fires, `loading` stays true, and the splash
     * stays on screen forever with no 再試行 on it, because a screen that never
     * got as far as loading its data cannot show its own error.
     *
     * So the gate gets the same deadline as everything behind it. Timing out
     * here does not claim the student is signed out — it says we could not find
     * out, which is a different sentence and one they can act on.
     */
    let settled = false;
    const deadline = setTimeout(() => {
      if (settled) return;
      setBlocked("サインイン状態を確認できませんでした。");
      setLoading(false);
    }, LOAD_TIMEOUT_MS);

    let unsubscribe: () => void;
    try {
      // Firebase reads the persisted session from IndexedDB asynchronously, so
      // the first callback is what tells us whether anyone is actually signed in.
      const auth = getFirebaseAuth();
      mark("auth:onAuthStateChanged 購読");
      unsubscribe = onAuthStateChanged(auth, (next) => {
        settled = true;
        clearTimeout(deadline);
        mark(`auth:発火 (${next ? "サインイン済み" : "サインアウト"})`);

        const gen = ++generation.current;
        setUser(next);
        setBlocked(null);

        if (!next) {
          setUserDoc(null);
          setLoading(false);
          mark("gate:開通 (サインアウト)");
          return;
        }

        setLoading(true);
        const recordConsent = pendingConsent.current;
        pendingConsent.current = false;

        // Bounded for the same reason. `loading` clears in the `finally`, which
        // only runs if this settles, and Firestore on an unreachable backend
        // does not settle on its own.
        mark("userdoc:users/{uid} 読み取り開始");
        withTimeout(
          ensureUserDoc(next, { recordConsent }),
          LOAD_TIMEOUT_MS,
          "プロフィールの読み込みに時間がかかりすぎています。",
        )
          .then((doc) => {
            mark("userdoc:読み取り完了");
            if (gen !== generation.current) return;
            setUserDoc(doc);
          })
          .catch(() => {
            if (gen !== generation.current) return;
            setUserDoc(null);
            // Blocked rather than merely noted: without the document we cannot
            // tell whether they have finished onboarding, and "/" used to
            // resolve that by sending them through it a second time. A 再試行
            // is the honest option.
            setBlocked("プロフィールを読み込めませんでした。");
          })
          .finally(() => {
            if (gen !== generation.current) return;
            setLoading(false);
            mark("gate:開通 — ここで初めて画面が描かれ始める");
          });
      });
    } catch (e) {
      // getFirebaseApp throws when the NEXT_PUBLIC_FIREBASE_* values are
      // missing. Thrown from an effect it would take out the whole tree; said
      // out loud it is a message with a cause in it.
      console.error("[auth] could not reach Firebase Auth", e);
      clearTimeout(deadline);
      setBlocked("サインイン状態を確認できませんでした。");
      setLoading(false);
      return;
    }

    return () => {
      clearTimeout(deadline);
      unsubscribe();
    };
  }, [attempt]);

  const retryAuth = useCallback(() => setAttempt((n) => n + 1), []);

  const signInWithGoogle = useCallback(async (agreedToTerms: boolean) => {
    setError(null);
    setBlocked(null);
    pendingConsent.current = agreedToTerms;
    try {
      await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
    } catch (e) {
      pendingConsent.current = false;
      const code = (e as { code?: string }).code ?? "";
      // Closing the popup is a normal thing to do, not an error worth showing.
      if (
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request"
      ) {
        return;
      }
      // The code as well as the sentence: a configuration error is read by
      // whoever is fixing the configuration, and they need the string Firebase
      // actually returned, not our paraphrase of it.
      console.error(`[auth] sign-in failed (${code || "unknown"})`, e);
      setError(signInMessage(code));
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
      blocked,
      retryAuth,
      signInWithGoogle,
      signOut,
      applyOnboarding,
    }),
    [
      user,
      userDoc,
      loading,
      error,
      blocked,
      retryAuth,
      signInWithGoogle,
      signOut,
      applyOnboarding,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
