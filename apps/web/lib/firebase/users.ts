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
 */
export async function ensureUserDoc(user: User): Promise<UserDoc> {
  const ref = userRef(user.uid);
  const snap = await getDoc(ref);

  const identity = {
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
    updatedAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    await setDoc(ref, {
      ...identity,
      profile: null,
      onboardingCompleted: false,
      createdAt: serverTimestamp(),
    });
    return {
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
      profile: null,
      onboardingCompleted: false,
      createdAt: null,
      updatedAt: null,
    };
  }

  await setDoc(ref, identity, { merge: true });
  return toUserDoc(snap.data());
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
