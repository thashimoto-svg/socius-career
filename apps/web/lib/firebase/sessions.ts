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
  updateDoc,
  where,
  writeBatch,
  deleteDoc,
} from "firebase/firestore";
import { getDb } from "./client";
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

export async function getSessionMessages(
  uid: string,
  sessionId: string,
): Promise<Message[]> {
  const snap = await getDocs(
    query(messagesRef(uid, sessionId), orderBy("createdAt", "asc"), limit(200)),
  );
  return snap.docs.map((d) => toMessage(d.id, d.data()));
}

export type OpenedChat = { session: Session; messages: Message[] };

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
  const session =
    // A link to a session that no longer exists falls through to the normal
    // path rather than stranding the student on a blank screen.
    (opts.resumeId ? await resumeById(uid, opts.resumeId) : null) ??
    (await getOrCreateOpenSession(uid, opts.fallback));

  return { session, messages: await getSessionMessages(uid, session.id) };
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

/** Whether this 壁打ち is still there — what the 自分史 asks before linking to one. */
export async function sessionExists(
  uid: string,
  sessionId: string,
): Promise<boolean> {
  const snap = await getDoc(sessionRef(uid, sessionId));
  return snap.exists();
}

/**
 * How many messages one delete pass takes.
 *
 * A Firestore batch holds 500 writes, and going over is a rejection of the
 * whole batch rather than of the extra ones. 400 leaves room to be wrong about
 * that limit without a student's longest conversation being the thing that
 * discovers it.
 */
const MESSAGE_DELETE_BATCH = 400;

/**
 * Delete a 壁打ち and its transcript. The 自分史 is not touched.
 *
 * That asymmetry is the whole point: 壁打ち is the process and 自分史 is what
 * the student is left with, so throwing away a conversation must never throw
 * away the episodes extracted from it. Their `sessionId` is left pointing at a
 * session that is gone — the 自分史 hides its 「元の対話を見る」 link when the
 * session no longer exists rather than the episode being rewritten or dropped.
 *
 * Callers must abandon extraction for this session first (see
 * `abandonExtraction`), or a run already in flight can write to the document
 * this is removing.
 */
export async function deleteSession(
  uid: string,
  sessionId: string,
): Promise<void> {
  // Firestore does not cascade; drop the transcript before the parent so a
  // failure halfway through leaves the session visible rather than orphaning
  // messages under a document that no longer exists.
  //
  // Paged rather than read in one go: a long 壁打ち is hundreds of messages,
  // and both the read and the batch that follows it have limits. Re-querying
  // from the start each time is correct precisely because the previous page is
  // gone by then.
  for (;;) {
    const page = await getDocs(
      query(messagesRef(uid, sessionId), limit(MESSAGE_DELETE_BATCH)),
    );
    if (page.empty) break;

    const batch = writeBatch(getDb());
    for (const d of page.docs) batch.delete(d.ref);
    await batch.commit();

    // A short page is the last one. Without this the loop would spend one more
    // round trip on every delete just to be told the collection is empty.
    if (page.size < MESSAGE_DELETE_BATCH) break;
  }

  await deleteDoc(sessionRef(uid, sessionId));
}
