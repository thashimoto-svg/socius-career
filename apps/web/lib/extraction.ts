import type { User } from "firebase/auth";
import { postJson } from "./api-client";
import { createEpisode, listEpisodes, updateEpisode } from "./firebase/episodes";
import { markExtracted } from "./firebase/sessions";
import type { Message, Session, Star } from "./firebase/schema";
import { isSameEpisode } from "./similarity";

/**
 * Turning a 壁打ち into 自分史 cards, without the student having to ask.
 *
 * 「セッションを終えてエピソードとして残す」 was a button, and a button is a step
 * that can be skipped — students talked, closed the app, and their 自分史 stayed
 * empty. Extraction now happens on its own at the moments a conversation is
 * actually finished with: leaving it for another thread, starting a new one, or
 * coming back to the app after it has grown.
 *
 * Because it repeats over the same growing conversation, the two things that
 * matter are that it only looks at what is new, and that it cannot leave the
 * same story on the 自分史 twice.
 */

type ExtractReply = {
  episode: {
    title: string;
    tag: string;
    emotion: string;
    star: Star;
    learn: string;
  } | null;
  reason?: string;
};

export type ExtractionOutcome =
  | { kind: "created"; title: string }
  | { kind: "updated"; title: string }
  | { kind: "nothing" }
  | { kind: "failed"; message: string };

/**
 * How much has to have been said since the last run for another one to be
 * worth it.
 *
 * Leaving a conversation is a strong signal that it is finished with, so two
 * new lines is enough there. Merely re-opening the app is not — 6 is the
 * number from the 7/30 MTG, and it is about one exchange more than the depth
 * ladder needs to reach a concrete fact.
 */
export const MIN_NEW_ON_LEAVE = 2;
export const MIN_NEW_ON_RESUME = 6;

/**
 * Whether this 壁打ち has enough unread conversation to be worth a run.
 *
 * A new *student* turn is required, not just any new line: the AI's opening
 * question on a fresh session is one message that contains nothing to extract,
 * and running on it would spend a request to be told there is nothing there.
 */
export function hasNewMaterial(
  session: Session,
  messages: Message[],
  minNew: number,
): boolean {
  const unread = messages.slice(session.extractedCount);
  return unread.length >= minNew && unread.some((m) => m.role === "user");
}

/**
 * Run one extraction over a 壁打ち and put the result on the 自分史.
 *
 * The whole transcript is sent, not only the unread tail: a STAR card needs the
 * situation and the result, and those are usually in different parts of the
 * conversation. What makes the run incremental is that the model is told which
 * episodes are already saved and asked for one that is not.
 *
 * Never throws. It runs where nobody is waiting for it, so a failure has to
 * come back as a value the caller can decide to mention or ignore.
 */
export async function extractEpisode(
  user: User,
  session: Session,
  messages: Message[],
): Promise<ExtractionOutcome> {
  try {
    // Every episode, then narrowed to this 壁打ち. Filtered here rather than
    // queried by sessionId so this needs no composite index; the list is capped
    // at 100 and a student's 自分史 is nowhere near that.
    const all = await listEpisodes(user.uid);
    const fromThisSession = all.filter((e) => e.sessionId === session.id);

    const { episode } = await postJson<ExtractReply>("/api/extract", user, {
      messages: messages.map((m) => ({ role: m.role, text: m.text })),
      savedTitles: fromThisSession.map((e) => e.title),
    });

    if (!episode) {
      // Nothing new to save is a normal result, and the transcript still counts
      // as read — otherwise the same barren stretch would be re-sent forever.
      await markExtracted(user.uid, session.id, {
        extractedCount: messages.length,
        addedEpisode: false,
      });
      return { kind: "nothing" };
    }

    // The model was asked not to repeat itself. This is what happens when it
    // does: the later, longer telling of the same story replaces the earlier
    // one rather than sitting next to it.
    const duplicate = fromThisSession.find((e) => isSameEpisode(e.title, episode.title));

    if (duplicate) {
      await updateEpisode(user.uid, duplicate.id, episode);
      await markExtracted(user.uid, session.id, {
        extractedCount: messages.length,
        addedEpisode: false,
      });
      return { kind: "updated", title: episode.title };
    }

    await createEpisode(user.uid, { ...episode, sessionId: session.id });
    await markExtracted(user.uid, session.id, {
      extractedCount: messages.length,
      addedEpisode: true,
    });
    return { kind: "created", title: episode.title };
  } catch (e) {
    // extractedCount is deliberately left alone: the conversation has not been
    // read, so the next trigger should try it again.
    console.error("[extraction] failed", e);
    return {
      kind: "failed",
      message: e instanceof Error ? e.message : "エピソードを残せませんでした。",
    };
  }
}
