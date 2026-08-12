import { listEpisodes } from "./firebase/episodes";
import { listSessions } from "./firebase/sessions";
import type { Episode, Session } from "./firebase/schema";

/**
 * What ホーム is made of, in a file of its own so that "/" can start fetching it
 * before it knows ホーム is where the student is going.
 *
 * The entry route has to read `users/{uid}` before it can choose between
 * ホーム and オンボーディング, and that read used to hold up everything: session,
 * then profile, then — once the redirect had landed and the screen had mounted
 * — the two queries below. Three round trips in a line, of which only the first
 * two have any order between them. These need the uid and nothing else, so they
 * can run next to the profile read instead of behind it.
 *
 * The cost is two wasted queries for a student who turns out to be heading to
 * オンボーディング instead. That happens once per account, and the reads are
 * against an empty collection at that point.
 */

export const HOME_SCOPE = "home";

export type HomeSummary = {
  episodes: Episode[];
  latest: Session | null;
};

export async function loadHomeSummary(uid: string): Promise<HomeSummary> {
  const [episodes, sessions] = await Promise.all([
    listEpisodes(uid),
    listSessions(uid),
  ]);
  // listSessions is already newest-first.
  return { episodes, latest: sessions[0] ?? null };
}
