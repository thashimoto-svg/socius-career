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
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import { isInAppBrowser } from "../in-app-browser";
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
  /**
   * True until Firebase has restored (or ruled out) a persisted session.
   *
   * This is the only wait every screen must sit behind, because until it clears
   * there is no uid and therefore nothing any screen could ask for.
   */
  sessionLoading: boolean;
  /**
   * True while `users/{uid}` is being read. Deliberately separate from
   * `sessionLoading`: the uid is known before this finishes, so a screen that
   * only needs the uid can already be fetching its own data alongside it. Only
   * the screens whose decisions are made of the profile wait for this.
   */
  profileLoading: boolean;
  /** Set when the last sign-in attempt failed, for display to the student. */
  error: string | null;
  /**
   * Set when the gate itself failed — the session could not be restored, so the
   * app cannot say who the student is. Distinct from `error`, which is about a
   * sign-in they just attempted.
   */
  blocked: string | null;
  /**
   * Set when the profile read failed. Its own field rather than part of
   * `blocked` because it stops less: a screen can show a 壁打ち without knowing
   * the student's 学年. What it does stop is any decision made of the profile.
   */
  profileError: string | null;
  /** Try the gate again — both halves of it. What every 再試行 here calls. */
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

    // The two ways an embedded browser refuses, after the redirect fallback has
    // already been tried. Both point at the same fix, and it is the one the
    // panel under the button offers: leave the app's browser.
    //
    // `web-storage-unsupported` is the common one — LINE and Instagram hand the
    // page a WebView with third-party storage switched off, and Firebase Auth
    // cannot complete either flow without somewhere to keep the session.
    case "auth/web-storage-unsupported":
    case "auth/operation-not-supported-in-this-environment":
      return (
        "このアプリ内ブラウザではサインインできません。\n" +
        "右上のメニューから Safari / Chrome で開いてから、もう一度お試しください。"
      );

    // This one really is worth another go.
    case "auth/network-request-failed":
      return "通信に失敗しました。通信状況を確認して、もう一度お試しください。";

    default:
      return "サインインできませんでした。時間をおいてもう一度お試しください。";
  }
}

/**
 * Where consent waits while the browser is somewhere else.
 *
 * The popup flow keeps the checkbox's answer in a ref, because the page that
 * asked is still the page that hears the result. The redirect flow leaves: the
 * document is torn down, Google is visited, and a *new* page load is what
 * eventually sees the signed-in student. A ref cannot survive that, and without
 * it `ensureUserDoc` would record a first sign-in with no consent stamped
 * against it — the one fact the checkbox exists to produce.
 *
 * sessionStorage rather than localStorage: it belongs to this tab and this
 * attempt. A stale flag left in localStorage would stamp consent onto some
 * later sign-in that never showed the checkbox at all.
 */
const CONSENT_KEY = "sc:pending-consent";

/**
 * Read-and-clear. Storage is wrapped because the browsers this whole feature
 * exists for are exactly the ones that throw on touching it.
 */
function takePersistedConsent(): boolean {
  try {
    const found = window.sessionStorage.getItem(CONSENT_KEY);
    if (found) window.sessionStorage.removeItem(CONSENT_KEY);
    return found === "1";
  } catch {
    return false;
  }
}

function persistConsent(agreed: boolean): void {
  try {
    if (agreed) window.sessionStorage.setItem(CONSENT_KEY, "1");
  } catch {
    // A WebView with storage blocked. The sign-in is about to fail for the
    // same reason, and it will say so with a message that has a fix in it.
  }
}

/**
 * Which sign-in flow this browser can actually complete.
 *
 * Popup is the better experience where it works — the student stays on the
 * page, and a cancelled popup is a cancelled sign-in rather than a full page
 * load back to the start. It just does not work in an embedded browser, which
 * is where most of these students are.
 */
function shouldUseRedirect(): boolean {
  return isInAppBrowser();
}

/**
 * Popup failures worth re-attempting as a redirect.
 *
 * Deliberately short. `popup-closed-by-user` is not here — the student closed
 * it, and answering that by navigating the whole page to Google is the app
 * overruling them. Neither is `cancelled-popup-request`, which means a second
 * popup was requested while one was already open: there is still a live attempt,
 * and a redirect would throw it away.
 *
 * What is here is the two shapes of "this browser will not do popups", which is
 * the case the detection above missed — an unlisted WebView, or a browser with
 * popups switched off. Falling back costs the student one page load instead of
 * an error they cannot act on.
 */
function popupFailureIsRecoverable(code: string): boolean {
  return (
    code === "auth/popup-blocked" ||
    code === "auth/operation-not-supported-in-this-environment"
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Signing out right after signing in would otherwise let the slower user-doc
  // fetch land last and resurrect a signed-out student's profile.
  const generation = useRef(0);

  // Consent belongs to the sign-in the student just performed, not to a session
  // Firebase restored from IndexedDB on page load — those must not stamp one.
  const pendingConsent = useRef(false);

  useEffect(() => {
    setBlocked(null);
    setProfileError(null);
    setSessionLoading(true);
    setProfileLoading(true);

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
      setSessionLoading(false);
      setProfileLoading(false);
    }, LOAD_TIMEOUT_MS);

    let unsubscribe: () => void;
    try {
      // Firebase reads the persisted session from IndexedDB asynchronously, so
      // the first callback is what tells us whether anyone is actually signed in.
      const auth = getFirebaseAuth();

      // Before subscribing, not after.
      //
      // On the way back from a redirect sign-in, Firebase resolves the result
      // during its own initialisation and *then* fires the first
      // onAuthStateChanged with the new user. If the consent flag were restored
      // in a `.then()` the callback would have already run and already called
      // ensureUserDoc without it. Reading it synchronously here means it is in
      // place whichever of the two lands first.
      //
      // It is also harmless on an ordinary page load: nothing wrote the key, so
      // this reads nothing and leaves the ref alone.
      if (takePersistedConsent()) pendingConsent.current = true;

      // The redirect's own outcome. `onAuthStateChanged` reports the *session*
      // and will fire with the signed-in student on its own — what it cannot
      // report is a redirect that came back having failed, because that ends
      // with no session and looks exactly like never having tried. This is the
      // only place that error exists.
      //
      // Not awaited and not part of the gate: a null result is the normal case
      // (no redirect was in flight), and the deadline below already covers the
      // session read that every screen actually waits on.
      void getRedirectResult(auth)
        .then((result) => {
          if (result) mark("auth:リダイレクト帰還 — サインイン成功");
        })
        .catch((e: unknown) => {
          pendingConsent.current = false;
          const code = (e as { code?: string }).code ?? "";
          console.error(`[auth] redirect sign-in failed (${code || "unknown"})`, e);
          setError(signInMessage(code));
        });

      mark("auth:onAuthStateChanged 購読");
      unsubscribe = onAuthStateChanged(auth, (next) => {
        settled = true;
        clearTimeout(deadline);
        mark(`auth:発火 (${next ? "サインイン済み" : "サインアウト"})`);

        const gen = ++generation.current;
        setUser(next);
        setBlocked(null);
        // The uid is known now, and the uid is all a screen needs to start
        // asking for its own documents. Holding the gate shut until the profile
        // arrives is what made the two reads a queue instead of a pair.
        setSessionLoading(false);
        mark("gate:開通 — ここから画面は自分のデータを取りに行ける");

        if (!next) {
          setUserDoc(null);
          setProfileLoading(false);
          return;
        }

        setProfileLoading(true);
        setProfileError(null);
        const recordConsent = pendingConsent.current;
        pendingConsent.current = false;

        // Bounded for the same reason. `profileLoading` clears in the
        // `finally`, which only runs if this settles, and Firestore on an
        // unreachable backend does not settle on its own.
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
            // Recorded, not fatal. Without the document we cannot tell whether
            // they have finished onboarding — "/" used to resolve that by
            // sending them through it a second time, so that decision still
            // waits for a 再試行. What no longer waits is a 壁打ち the student
            // is in the middle of, which does not depend on their 学年.
            setProfileError("プロフィールを読み込めませんでした。");
          })
          .finally(() => {
            if (gen !== generation.current) return;
            setProfileLoading(false);
            mark("profile:確定");
          });
      });
    } catch (e) {
      // getFirebaseApp throws when the NEXT_PUBLIC_FIREBASE_* values are
      // missing. Thrown from an effect it would take out the whole tree; said
      // out loud it is a message with a cause in it.
      console.error("[auth] could not reach Firebase Auth", e);
      clearTimeout(deadline);
      setBlocked("サインイン状態を確認できませんでした。");
      setSessionLoading(false);
      setProfileLoading(false);
      return;
    }

    return () => {
      clearTimeout(deadline);
      unsubscribe();
    };
  }, [attempt]);

  const retryAuth = useCallback(() => setAttempt((n) => n + 1), []);

  /**
   * Leave for Google and come back signed in.
   *
   * Consent goes to sessionStorage first, because this call does not return —
   * it navigates the document away, and the ref holding the checkbox's answer
   * dies with it. The effect above picks the flag back up on the way in.
   */
  const startRedirect = useCallback(
    async (auth: Auth, agreedToTerms: boolean) => {
      persistConsent(agreedToTerms);
      try {
        await signInWithRedirect(auth, new GoogleAuthProvider());
      } catch (e) {
        // Thrown before the navigation happened, so the flag would otherwise
        // sit there waiting for a page load that never comes.
        takePersistedConsent();
        pendingConsent.current = false;
        const code = (e as { code?: string }).code ?? "";
        console.error(`[auth] redirect sign-in could not start (${code || "unknown"})`, e);
        setError(signInMessage(code));
      }
    },
    [],
  );

  const signInWithGoogle = useCallback(
    async (agreedToTerms: boolean) => {
      setError(null);
      setBlocked(null);
      setProfileError(null);
      pendingConsent.current = agreedToTerms;

      const auth = getFirebaseAuth();

      // LINE and Instagram hand the page a WebView, and a WebView has no window
      // that can post a popup's result back. Redirect is not a fallback there —
      // it is the only flow that can finish, so it is taken first rather than
      // after a failure the student would have watched do nothing.
      if (shouldUseRedirect()) {
        await startRedirect(auth, agreedToTerms);
        return;
      }

      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
      } catch (e) {
        const code = (e as { code?: string }).code ?? "";

        // Closing the popup is a normal thing to do, not an error worth showing.
        if (
          code === "auth/popup-closed-by-user" ||
          code === "auth/cancelled-popup-request"
        ) {
          pendingConsent.current = false;
          return;
        }

        // An embedded browser the token list above does not know about, or a
        // browser with popups turned off. Same answer either way, and the
        // student never has to be told which.
        if (popupFailureIsRecoverable(code)) {
          console.warn(`[auth] popup unavailable (${code}); retrying as redirect`);
          await startRedirect(auth, agreedToTerms);
          return;
        }

        pendingConsent.current = false;
        // The code as well as the sentence: a configuration error is read by
        // whoever is fixing the configuration, and they need the string Firebase
        // actually returned, not our paraphrase of it.
        console.error(`[auth] sign-in failed (${code || "unknown"})`, e);
        setError(signInMessage(code));
      }
    },
    [startRedirect],
  );

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
      sessionLoading,
      profileLoading,
      error,
      blocked,
      profileError,
      retryAuth,
      signInWithGoogle,
      signOut,
      applyOnboarding,
    }),
    [
      user,
      userDoc,
      sessionLoading,
      profileLoading,
      error,
      blocked,
      profileError,
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
