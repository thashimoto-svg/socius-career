import { getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import {
  toUserDoc,
  userRef,
  type OnboardingProfile,
  type UserDoc,
} from "./schema";

/**
 * Create the student's user document on first sign-in, and keep the Google
 * profile fields fresh on every later one.
 *
 * Merged rather than overwritten: `profile` and `onboardingCompleted` belong to
 * the student's own answers and must survive a re-login.
 *
 * Every screen in the app waits on this, so what it waits on matters. Only the
 * read is awaited. Refreshing a returning student's display name is
 * housekeeping — nothing on any screen reads it back, and a Firestore write
 * does not resolve until the server acknowledges it, which on a bad connection
 * is never. Blocking the first paint of the whole app on that acknowledgement
 * is how 「読み込んでいます…」 becomes permanent.
 */
export async function ensureUserDoc(
  user: User,
  opts: { recordConsent?: boolean } = {},
): Promise<UserDoc> {
  const ref = userRef(user.uid);
  const snap = await getDoc(ref);

  const identity = {
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
    updatedAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    // Reaching a first sign-in at all means the consent checkbox was ticked —
    // it is what enables the button.
    //
    // This one is awaited, unlike the refresh below: it is the write that makes
    // the account exist and the one that records the consent, and letting a
    // student into the app before either has landed would be claiming something
    // that has not happened. Its caller puts a deadline on it.
    await setDoc(ref, {
      ...identity,
      profile: null,
      onboardingCompleted: false,
      agreedToTermsAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    return {
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
      profile: null,
      onboardingCompleted: false,
      agreedToTermsAt: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  const existing = toUserDoc(snap.data());

  // Only stamped on a sign-in the student actually consented through, and only
  // if it is not already recorded. A restored session carries no consent, so it
  // must not backfill one for an account that predates the checkbox.
  const consent =
    opts.recordConsent && !existing.agreedToTermsAt
      ? { agreedToTermsAt: serverTimestamp() }
      : {};

  // Not awaited: see above. The write is queued and will land when it can —
  // including after a reload, since the SDK keeps it — and the student gets
  // their app now either way.
  void setDoc(ref, { ...identity, ...consent }, { merge: true }).catch((e) => {
    console.error("[users] could not refresh the profile fields", e);
  });

  return existing;
}

export async function getUserDoc(uid: string): Promise<UserDoc | null> {
  const snap = await getDoc(userRef(uid));
  return snap.exists() ? toUserDoc(snap.data()) : null;
}

/**
 * Store the onboarding answers. This is what lets the 壁打ち open with context
 * the student never had to type — the 「プロンプトを考える必要はありません」 promise.
 */
export async function saveOnboarding(
  uid: string,
  profile: OnboardingProfile,
): Promise<void> {
  await setDoc(
    userRef(uid),
    { profile, onboardingCompleted: true, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
