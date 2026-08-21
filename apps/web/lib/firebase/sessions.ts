import {
  EMPTY_WORKSHEET,
  worksheetProgress,
  type Worksheet,
} from "@socius/prompts";
import {
  addDoc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  deleteDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getDb } from "./client";
import {
  messageRef,
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
    // Not written to the document. An absent field and an empty sheet read the
    // same way (toWorksheet), and a 壁打ち nobody has said anything in has
    // nothing to write down yet.
    worksheet: EMPTY_WORKSHEET,
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

  return { id: ref.id, ...msg, createdAt: null, editedAt: null };
}

/**
 * Rename a 壁打ち — what ✎ in the 履歴 list writes.
 *
 * `updatedAt` is left alone, the same way saveWorksheet and markExtracted leave
 * it. The list is ordered by it, so touching it would send the row the student
 * has just renamed to the top of the screen they renamed it on — a conversation
 * jumping position because its title was corrected is the app answering a
 * question nobody asked. The date on the row means 「最後に話した日」, and giving
 * a thread a better name is not talking to it.
 *
 * Titles are capped in firestore.rules at 200 characters; the field caps
 * itself at the same number rather than letting the write be the thing that
 * says no.
 */
export const TITLE_MAX_LENGTH = 200;

export async function renameSession(
  uid: string,
  sessionId: string,
  title: string,
): Promise<void> {
  await updateDoc(sessionRef(uid, sessionId), {
    title: title.slice(0, TITLE_MAX_LENGTH),
  });
}

/**
 * Correct one of the student's own turns.
 *
 * The reply that followed is deliberately left alone. Regenerating it would be
 * the thorough answer and the wrong one for this: the AI's line is the record
 * of what it actually said, the student read it, and replacing it would rewrite
 * a conversation that already happened. The correction is carried into the
 * *next* request instead, because that request is built from the transcript —
 * so from the following turn on, the model sees what the student meant.
 *
 * `editedAt` is not optional: firestore.rules requires it on every update, so
 * a line cannot be changed without the transcript recording that it was.
 */
export async function editUserMessage(
  uid: string,
  sessionId: string,
  messageId: string,
  text: string,
): Promise<void> {
  await updateDoc(messageRef(uid, sessionId, messageId), {
    text,
    editedAt: serverTimestamp(),
  });
}

/**
 * Remove a turn the student took, and the reply it drew.
 *
 * The pair goes together because a question with nothing in front of it is
 * worse than nothing: an AI line asking 「どんな部活でしたか?」 under a
 * transcript that no longer contains the student mentioning a 部活 reads as the
 * app talking to itself, and it is what the next request would be built from.
 *
 * `turnCount` follows, because 「N往復」 in the 履歴 list counts the student's
 * turns and a deleted one did not happen. `extractedCount` follows too: it
 * counts transcript lines from the beginning, so lines removed from *before*
 * the mark have to come off it or the mark points past the end of a
 * conversation that is now shorter — and the 自分史 would quietly stop reading
 * anything new until the transcript grew back past it.
 */
export async function deleteMessages(
  uid: string,
  sessionId: string,
  messageIds: string[],
  counters: { userTurns: number; extractedBefore: number },
): Promise<void> {
  const batch = writeBatch(getDb());
  for (const id of messageIds) batch.delete(messageRef(uid, sessionId, id));

  const patch: Record<string, unknown> = {};
  if (counters.userTurns > 0) patch.turnCount = increment(-counters.userTurns);
  if (counters.extractedBefore > 0) {
    patch.extractedCount = increment(-counters.extractedBefore);
  }
  // updatedAt is left where it is, like every other write that is bookkeeping
  // rather than conversation: tidying up a turn must not send the thread to the
  // top of the 履歴 list.
  if (Object.keys(patch).length > 0) batch.update(sessionRef(uid, sessionId), patch);

  await batch.commit();
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
 * 学生が直したシートを書き戻す。
 *
 * サーバーにも同じことをする道がある(lib/server/worksheet.ts)。分かれているのは
 * 誰が書いたかではなく、いつ書くか: あちらは返答を読み終えた直後、こちらは学生が
 * シートを開いて保存を押した瞬間で、そのとき返答は流れていない。
 *
 * `progress` を一緒に書くのはあちらと同じ理由——レールはシートから導かれるので、
 * 「行動」の欄を学生が消したのにレールが埋まったままなら、二つは同じものを指して
 * いないことになる。
 *
 * `updatedAt` は触らない。markExtracted と同じ理由で、整理し直したことは
 * 「最後に話した日」ではない。
 */
export async function saveWorksheet(
  uid: string,
  sessionId: string,
  worksheet: Worksheet,
): Promise<void> {
  await updateDoc(sessionRef(uid, sessionId), {
    worksheet,
    progress: worksheetProgress(worksheet),
  });
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
