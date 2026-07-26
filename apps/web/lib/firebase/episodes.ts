import {
  addDoc,
  deleteDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  episodeRef,
  episodesRef,
  toEpisode,
  type Episode,
  type Star,
} from "./schema";

export type EpisodeDraft = {
  title: string;
  tag: string;
  emotion: string;
  star: Star;
  learn: string;
  sessionId: string | null;
};

/** Newest first — the 自分史 reads as a growing record, most recent on top. */
export async function listEpisodes(uid: string): Promise<Episode[]> {
  const snap = await getDocs(
    query(episodesRef(uid), orderBy("createdAt", "desc"), limit(100)),
  );
  return snap.docs.map((d) => toEpisode(d.id, d.data()));
}

export async function createEpisode(
  uid: string,
  draft: EpisodeDraft,
): Promise<string> {
  const ref = await addDoc(episodesRef(uid), {
    ...draft,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * The student owns these cards, so editing is a first-class operation rather
 * than a correction path (docs/specs/ui-notes.md, 「本人の所有感を担保」).
 */
export async function updateEpisode(
  uid: string,
  episodeId: string,
  patch: Partial<EpisodeDraft>,
): Promise<void> {
  await updateDoc(episodeRef(uid, episodeId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteEpisode(
  uid: string,
  episodeId: string,
): Promise<void> {
  await deleteDoc(episodeRef(uid, episodeId));
}
