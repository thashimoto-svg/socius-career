import {
  collection,
  doc,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";
import { getDb } from "./client";

/**
 * The shape of the student's document tree, and the only place that knows
 * where anything lives.
 *
 * Everything hangs off `users/{uid}` as subcollections rather than sitting in
 * top-level collections keyed by a `userId` field. That makes ownership a
 * property of the path, which is what firestore.rules checks — a query can't
 * accidentally reach across students because there is no path that spans them.
 */

export type ChatMode = "counselor" | "karakuchi";

/** Answers from the onboarding survey, fed into the 壁打ち system prompt. */
export type OnboardingProfile = {
  grade: string;
  club: string;
  industries: string[];
};

export type UserDoc = {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  profile: OnboardingProfile | null;
  onboardingCompleted: boolean;
  /**
   * When the student ticked 「プライバシーポリシーと利用規約に同意する」 on the
   * login screen. Null for accounts created before the checkbox existed.
   */
  agreedToTermsAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type SessionStatus = "open" | "closed";

export type Session = {
  id: string;
  title: string;
  /** 上部に出る「今日のテーマ」. */
  theme: string;
  mode: ChatMode;
  status: SessionStatus;
  /** Number of student turns — what the history screen shows as 「N往復」. */
  turnCount: number;
  episodeCount: number;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type MessageRole = "user" | "ai";

export type Message = {
  id: string;
  role: MessageRole;
  text: string;
  /** Which tone produced an AI line; null for the student's own words. */
  mode: ChatMode | null;
  createdAt: Date | null;
};

export type Star = { S: string; T: string; A: string; R: string };

export type Episode = {
  id: string;
  title: string;
  tag: string;
  emotion: string;
  star: Star;
  learn: string;
  /** The 壁打ち this was extracted from, so history can link to it. */
  sessionId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function userRef(uid: string): DocumentReference<DocumentData> {
  return doc(getDb(), "users", uid);
}

export function sessionsRef(uid: string): CollectionReference<DocumentData> {
  return collection(getDb(), "users", uid, "sessions");
}

export function sessionRef(uid: string, sessionId: string) {
  return doc(getDb(), "users", uid, "sessions", sessionId);
}

export function messagesRef(uid: string, sessionId: string) {
  return collection(getDb(), "users", uid, "sessions", sessionId, "messages");
}

export function episodesRef(uid: string): CollectionReference<DocumentData> {
  return collection(getDb(), "users", uid, "episodes");
}

export function episodeRef(uid: string, episodeId: string) {
  return doc(getDb(), "users", uid, "episodes", episodeId);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * `serverTimestamp()` resolves on the server, so a document read straight back
 * from the local cache has `null` where the timestamp will be. Callers treat a
 * null as "just now" rather than crashing on `.toDate()`.
 */
export function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null;
}

export function toSession(id: string, d: DocumentData): Session {
  return {
    id,
    title: typeof d.title === "string" ? d.title : "無題の壁打ち",
    theme: typeof d.theme === "string" ? d.theme : "",
    mode: d.mode === "karakuchi" ? "karakuchi" : "counselor",
    status: d.status === "closed" ? "closed" : "open",
    turnCount: typeof d.turnCount === "number" ? d.turnCount : 0,
    episodeCount: typeof d.episodeCount === "number" ? d.episodeCount : 0,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export function toMessage(id: string, d: DocumentData): Message {
  return {
    id,
    role: d.role === "ai" ? "ai" : "user",
    text: typeof d.text === "string" ? d.text : "",
    mode: d.mode === "counselor" || d.mode === "karakuchi" ? d.mode : null,
    createdAt: toDate(d.createdAt),
  };
}

export function toEpisode(id: string, d: DocumentData): Episode {
  const star = (d.star ?? {}) as Partial<Star>;
  return {
    id,
    title: typeof d.title === "string" ? d.title : "",
    tag: typeof d.tag === "string" ? d.tag : "",
    emotion: typeof d.emotion === "string" ? d.emotion : "",
    star: {
      S: star.S ?? "",
      T: star.T ?? "",
      A: star.A ?? "",
      R: star.R ?? "",
    },
    learn: typeof d.learn === "string" ? d.learn : "",
    sessionId: typeof d.sessionId === "string" ? d.sessionId : null,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export function toUserDoc(d: DocumentData): UserDoc {
  const p = d.profile as Partial<OnboardingProfile> | undefined;
  return {
    displayName: d.displayName ?? null,
    email: d.email ?? null,
    photoURL: d.photoURL ?? null,
    profile: p
      ? {
          grade: p.grade ?? "",
          club: p.club ?? "",
          industries: Array.isArray(p.industries) ? p.industries : [],
        }
      : null,
    onboardingCompleted: d.onboardingCompleted === true,
    agreedToTermsAt: toDate(d.agreedToTermsAt),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

/** 「7/18」 — the compact date the history list shows. */
export function formatShortDate(date: Date | null): string {
  const d = date ?? new Date();
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
