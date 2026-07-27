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
  deleteDoc,
} from "firebase/firestore";
import { withTimeout } from "../with-timeout";
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

/** How long /chat waits for a session and its transcript before giving up. */
const OPEN_TIMEOUT_MS = 10_000;

export type OpenedChat = { session: Session; messages: Message[] };

/**
 * Everything the 壁打ち screen needs to start rendering: which conversation to
 * continue, and what has been said in it so far.
 *
 * Bounded on purpose. Whatever goes wrong underneath — an unreachable backend,
 * a rule that says no, an index that is still building — has to end in either a
 * session or an error, because the screen has no third state to offer.
 */
export async function openChat(
  uid: string,
  opts: {
    /** The session the 履歴 screen or the drawer linked to, if any. */
    resumeId: string | null;
    fallback: { title: string; theme: string; mode: ChatMode };
  },
): Promise<OpenedChat> {
  return withTimeout(
    (async () => {
      const session =
        // A link to a session that no longer exists falls through to the
        // normal path rather than stranding the student on a blank screen.
        (opts.resumeId ? await resumeById(uid, opts.resumeId) : null) ??
        (await getOrCreateOpenSession(uid, opts.fallback));

      return { session, messages: await getSessionMessages(uid, session.id) };
    })(),
    OPEN_TIMEOUT_MS,
    "壁打ちの読み込みに時間がかかりすぎています。",
  );
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
