import type { ProgressStep } from "@socius/prompts";
import {
  addDoc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  deleteDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import {
  messagesRef,
  sessionRef,
  sessionsRef,
  toMessage,
  toSession,
  type ChatMode,
  type Message,
  type MessageRole,
  type Session,
} from "./schema";

/** Newest first — the order the 履歴 screen lists them in. */
export async function listSessions(uid: string): Promise<Session[]> {
  const snap = await getDocs(
    query(sessionsRef(uid), orderBy("updatedAt", "desc"), limit(50)),
  );
  return snap.docs.map((d) => toSession(d.id, d.data()));
}

export async function createSession(
  uid: string,
  opts: { title: string; theme: string; mode: ChatMode },
): Promise<Session> {
  const ref = await addDoc(sessionsRef(uid), {
    title: opts.title,
    theme: opts.theme,
    mode: opts.mode,
    status: "open",
    turnCount: 0,
    episodeCount: 0,
    extractedCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return {
    id: ref.id,
    title: opts.title,
    theme: opts.theme,
    mode: opts.mode,
    status: "open",
    turnCount: 0,
    episodeCount: 0,
    extractedCount: 0,
    progress: [],
    createdAt: null,
    updatedAt: null,
  };
}

/**
 * Resume the student's most recent unfinished 壁打ち, or start a new one.
 *
 * 「対話が単発で消費されない」 (docs/specs/ui-notes.md) — walking away mid-session
 * and coming back later has to land you where you left off, so /chat resumes by
 * default rather than opening a blank conversation every time.
 */
export async function getOrCreateOpenSession(
  uid: string,
  fallback: { title: string; theme: string; mode: ChatMode },
): Promise<Session> {
  const snap = await getDocs(
    query(
      sessionsRef(uid),
      where("status", "==", "open"),
      orderBy("updatedAt", "desc"),
      limit(1),
    ),
  );

  const existing = snap.docs[0];
  if (existing) return toSession(existing.id, existing.data());

  return createSession(uid, fallback);
}

/**
 * How many lines of a 壁打ち are read at once.
 *
 * This used to be a `limit(200)` on an ascending query, which is not a cap on
 * how much is read so much as a decision about *which* 200 — and it picked the
 * wrong end. A conversation longer than the cap opened on its first 200 lines
 * with everything recent invisible, and the student was left looking at the
 * opening of a thread they came back to continue.
 *
 * Read from the newest end and turned round, so the cap now takes the part of
 * the conversation that is actually being continued. What is above it is
 * reachable through `getOlderMessages`.
 */
export const TRANSCRIPT_PAGE = 60;

/**
 * Enough of a 壁打ち to carry on with, and whether that is all of it.
 *
 * `complete` is what stops the tail being mistaken for the whole thing.
 * `extractedCount` counts transcript lines from the beginning, so anything
 * that does arithmetic against it — 自分史 extraction, in practice — has to
 * know when it is holding a slice rather than the conversation.
 */
export type Transcript = { messages: Message[]; complete: boolean };

function toTranscript(
  docs: QueryDocumentSnapshot<DocumentData>[],
  page: number,
): Transcript {
  // One more than the page was asked for, so "is there anything above this"
  // is answered by the read that was happening anyway rather than by a second
  // query for a question with a one-word answer.
  const kept = docs.slice(0, page).reverse();
  return {
    messages: kept.map((d) => toMessage(d.id, d.data())),
    complete: docs.length <= page,
  };
}

/** The newest `page` lines, oldest-first — the order they are read in. */
export async function getSessionMessages(
  uid: string,
  sessionId: string,
  page: number = TRANSCRIPT_PAGE,
): Promise<Transcript> {
  const snap = await getDocs(
    query(messagesRef(uid, sessionId), orderBy("createdAt", "desc"), limit(page + 1)),
  );
  return toTranscript(snap.docs, page);
}

/**
 * The page above `before` — what 「以前のメッセージを読み込む」 asks for.
 *
 * Cursored on the timestamp rather than on a document snapshot, because what
 * the screen is holding is a `Message`, and keeping the snapshots alive
 * alongside it would mean a second copy of the transcript in memory for the
 * sake of a field that is already on the first.
 */
export async function getOlderMessages(
  uid: string,
  sessionId: string,
  before: Date,
  page: number = TRANSCRIPT_PAGE,
): Promise<Transcript> {
  const snap = await getDocs(
    query(
      messagesRef(uid, sessionId),
      orderBy("createdAt", "desc"),
      startAfter(Timestamp.fromDate(before)),
      limit(page + 1),
    ),
  );
  return toTranscript(snap.docs, page);
}

/**
 * The whole transcript, however long it is.
 *
 * Only for 自分史 extraction, which needs the situation and the result and
 * cannot be handed the tail the screen happens to be showing. It runs in the
 * background where nobody is waiting, so the read it costs is affordable in a
 * way it would not be on the path to first paint.
 */
const WHOLE_TRANSCRIPT_LIMIT = 2000;

export async function getWholeTranscript(
  uid: string,
  sessionId: string,
): Promise<Message[]> {
  const { messages } = await getSessionMessages(uid, sessionId, WHOLE_TRANSCRIPT_LIMIT);
  return messages;
}

export type OpenedChat = Transcript & { session: Session };

/**
 * Everything the 壁打ち screen needs to start rendering: which conversation to
 * continue, and what has been said in it so far.
 *
 * The deadline that used to be written here is not gone — it moved to
 * lib/use-loadable, which now puts one on every screen's data rather than on
 * the single screen this bug was first reported against.
 */
export async function openChat(
  uid: string,
  opts: {
    /** The session the 履歴 screen or the drawer linked to, if any. */
    resumeId: string | null;
    fallback: { title: string; theme: string; mode: ChatMode };
  },
): Promise<OpenedChat> {
  // When the URL names a 壁打ち the two reads have no order between them: the
  // id is already known, and nothing in the session document decides which
  // messages belong to it. They used to run end to end under a single 10s
  // deadline, which is the shape that turns a slow phone into 「壁打ちを読み込
  // めませんでした」 — two round trips against one budget, on the screen with
  // the most to fetch.
  if (opts.resumeId) {
    const [session, transcript] = await Promise.all([
      resumeById(uid, opts.resumeId),
      getSessionMessages(uid, opts.resumeId),
    ]);
    // A link to a session that no longer exists falls through to the normal
    // path rather than stranding the student on a blank screen. The transcript
    // read is wasted in that case, and it is a read against a collection that
    // is also gone.
    if (session) return { session, ...transcript };
  }

  const session = await getOrCreateOpenSession(uid, opts.fallback);
  return { session, ...(await getSessionMessages(uid, session.id)) };
}

/**
 * Resume the session the 履歴 screen linked to. A finished session reopens
 * rather than starting a new one — the student came back to this conversation
 * on purpose.
 */
async function resumeById(
  uid: string,
  sessionId: string,
): Promise<Session | null> {
  const snap = await getDoc(sessionRef(uid, sessionId));
  if (!snap.exists()) return null;

  const session = toSession(snap.id, snap.data());
  if (session.status === "closed") {
    await reopenSession(uid, sessionId);
    return { ...session, status: "open" };
  }
  return session;
}

/**
 * Append one line to the transcript.
 *
 * Only the student's turns move `turnCount`, because 「N往復」 in the history list
 * counts exchanges, not messages.
 */
export async function appendMessage(
  uid: string,
  sessionId: string,
  msg: { role: MessageRole; text: string; mode: ChatMode | null },
): Promise<Message> {
  const ref = await addDoc(messagesRef(uid, sessionId), {
    role: msg.role,
    text: msg.text,
    mode: msg.mode,
    createdAt: serverTimestamp(),
  });

  await updateDoc(sessionRef(uid, sessionId), {
    updatedAt: serverTimestamp(),
    ...(msg.role === "user" ? { turnCount: increment(1) } : {}),
  });

  return { id: ref.id, ...msg, createdAt: null };
}

export async function updateSessionMeta(
  uid: string,
  sessionId: string,
  patch: Partial<Pick<Session, "title" | "theme" | "mode" | "status">>,
): Promise<void> {
  await updateDoc(sessionRef(uid, sessionId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Record which of the five 節 the conversation has now covered.
 *
 * `updatedAt` is left alone on purpose, the same way markExtracted leaves it:
 * the reply that carried these markers has already moved it, and touching it
 * again from a second write would reorder the history list for a reason the
 * student did nothing to cause.
 */
export async function saveProgress(
  uid: string,
  sessionId: string,
  progress: ProgressStep[],
): Promise<void> {
  await updateDoc(sessionRef(uid, sessionId), { progress });
}

/**
 * Record that extraction has read this 壁打ち up to `extractedCount` lines.
 *
 * Written after the episode is saved rather than before, so a run that fails
 * halfway leaves the session looking un-extracted and gets tried again. The
 * duplicate check on the way in is what makes that safe to repeat.
 *
 * `episodeCount` only moves when a new card was actually created; updating an
 * existing one is not a second episode.
 */
export async function markExtracted(
  uid: string,
  sessionId: string,
  opts: { extractedCount: number; addedEpisode: boolean },
): Promise<void> {
  await updateDoc(sessionRef(uid, sessionId), {
    extractedCount: opts.extractedCount,
    // Deliberately not touching updatedAt: extraction is not something the
    // student did, and letting it reorder the history list would make threads
    // jump around on their own.
    ...(opts.addedEpisode ? { episodeCount: increment(1) } : {}),
  });
}

/**
 * Reopen a closed 壁打ち so the student can keep going. The transcript is kept —
 * nothing is discarded by finishing a session.
 *
 * Nothing closes a session any more: 「セッションを終える」 was the manual
 * extraction button, and extraction now runs on its own. This stays for the
 * sessions that were closed while that button existed.
 */
export async function reopenSession(
  uid: string,
  sessionId: string,
): Promise<void> {
  await updateDoc(sessionRef(uid, sessionId), {
    status: "open",
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSession(
  uid: string,
  sessionId: string,
): Promise<void> {
  // Firestore does not cascade; drop the transcript before the parent so a
  // failure halfway through leaves the session visible rather than orphaning
  // messages under a document that no longer exists.
  const snap = await getDocs(messagesRef(uid, sessionId));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(sessionRef(uid, sessionId));
}
