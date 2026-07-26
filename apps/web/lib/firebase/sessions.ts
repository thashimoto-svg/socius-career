import {
  addDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  deleteDoc,
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

export async function closeSession(
  uid: string,
  sessionId: string,
  opts: { addedEpisode: boolean },
): Promise<void> {
  await updateDoc(sessionRef(uid, sessionId), {
    status: "closed",
    updatedAt: serverTimestamp(),
    ...(opts.addedEpisode ? { episodeCount: increment(1) } : {}),
  });
}

/**
 * Reopen a closed 壁打ち so the student can keep going. The transcript is kept —
 * nothing is discarded by finishing a session.
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
