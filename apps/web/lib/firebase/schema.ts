import {
  EPISODE_PERIODS,
  toChoices,
  toProgress,
  toWorksheet,
  type EpisodePeriod,
  type ProgressStep,
  type Worksheet,
} from "@socius/prompts";
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
  /**
   * How many transcript lines had been read the last time an episode was
   * extracted from this 壁打ち.
   *
   * Extraction runs on its own now, so something has to say what has already
   * been looked at. Comparing this against the transcript length is what makes
   * a re-run a re-run of the *new* part rather than of the whole conversation.
   */
  extractedCount: number;
  /**
   * Which of the five 節 the conversation has actually covered — what the rail
   * under the header shows.
   *
   * Stored rather than recomputed, because the only place it exists is in the
   * markers the model appends to its replies, and those are stripped before a
   * message is saved. Keeping them in the transcript instead would put a
   * bracketed token in every document that the 自分史 extraction reads and the
   * 履歴 screen displays, one missed strip away from the student seeing it.
   */
  progress: ProgressStep[];
  /**
   * エピソードシート — この壁打ちで分かっていることの、一枚の整理。
   *
   * 会話そのものとは別に持っている。送るのは直近16往復だけなので、それより前の
   * 話はモデルの手元から消える——消えても残るものが要る、というのがこの欄で、
   * だから毎ターン依頼に同封され、毎ターン書き直される。`progress` はここから
   * 導かれた影で、レールが指しているものは必ずこの中に書いてある。
   *
   * 書くのはサーバー(返答から読み取ったもの)と学生本人(画面で直したもの)。
   */
  worksheet: Worksheet;
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
  /**
   * 押せる形で出す、答え方の見本。
   *
   * AIの発言にだけ付き、付かない回のほうが多い。保存しているのは、聞かれた
   * まま閉じたアプリを開き直したときに選択肢が消えていないため——問いは残って
   * いるのに選ぶものだけ無い画面は、答えを一つ失った会話に見える。
   */
  choices: string[];
  /**
   * When the student corrected their own words, if they did.
   *
   * Null on every line that has never been touched, which is nearly all of
   * them and all of the AI's. It is what the bubble's 「編集済み」 is drawn
   * from — a transcript the 自分史 is extracted from should not be able to
   * change without saying so.
   */
  editedAt: Date | null;
};

export type Star = { S: string; T: string; A: string; R: string };

export type Episode = {
  id: string;
  title: string;
  tag: string;
  /**
   * When it happened, on the 自分史's own scale — 「大学2年」 rather than a date.
   *
   * This is what places a card on the timeline. 「不明」 for the cards written
   * before the field existed, and for the ones where the student told the story
   * without ever saying which year it was.
   */
  period: EpisodePeriod;
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

export function messageRef(uid: string, sessionId: string, messageId: string) {
  return doc(getDb(), "users", uid, "sessions", sessionId, "messages", messageId);
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
    // Sessions created before extraction became automatic have no counter.
    // Reading them as 0 means their first automatic run looks at the whole
    // transcript, which is what you want — nothing has been read by this
    // mechanism yet, and the duplicate check catches anything the old manual
    // button already saved.
    extractedCount: typeof d.extractedCount === "number" ? d.extractedCount : 0,
    // Sessions from before the rail existed read as empty, which is honest:
    // nothing was ever judged about them. They fill from their next reply.
    progress: toProgress(d.progress),
    // Same for the sheet: a 壁打ち held before it existed opens with a blank
    // one, and the first reply of the next turn fills it in from the transcript
    // it can still see.
    worksheet: toWorksheet(d.worksheet),
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
    choices: toChoices(d.choices),
    createdAt: toDate(d.createdAt),
    editedAt: toDate(d.editedAt),
  };
}

export function toEpisode(id: string, d: DocumentData): Episode {
  const star = (d.star ?? {}) as Partial<Star>;
  return {
    id,
    title: typeof d.title === "string" ? d.title : "",
    tag: typeof d.tag === "string" ? d.tag : "",
    period: (EPISODE_PERIODS as readonly string[]).includes(d.period)
      ? (d.period as EpisodePeriod)
      : "不明",
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
