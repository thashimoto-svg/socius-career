import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

/**
 * Browser-side Firebase entry point.
 *
 * Next.js re-evaluates modules across hot reloads and route segments, so
 * everything here is a lazy singleton: `initializeApp` must run exactly once
 * per page load or the SDK throws on the second call.
 *
 * Auth and Firestore are resolved on first use rather than at import time, so
 * that a Server Component importing a type from this file does not drag the
 * browser-only SDKs into the server bundle.
 */

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function getFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();

  const missing = Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Firebase config is incomplete (missing: ${missing.join(", ")}). ` +
        "Copy .env.example to apps/web/.env.local and fill in the " +
        "NEXT_PUBLIC_FIREBASE_* values, then restart the dev server.",
    );
  }

  return initializeApp(firebaseConfig);
}

let authInstance: Auth | undefined;
let firestoreInstance: Firestore | undefined;

export function getFirebaseAuth(): Auth {
  authInstance ??= getAuth(getFirebaseApp());
  return authInstance;
}

export function getDb(): Firestore {
  firestoreInstance ??= getFirestore(getFirebaseApp());
  return firestoreInstance;
}
