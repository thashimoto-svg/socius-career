import { EPISODE_PERIODS, type EpisodePeriod } from "@socius/prompts";
import type { Episode } from "./firebase/schema";

/**
 * The shape of a 自分史, before anything has been written into it.
 *
 * The timeline exists whether or not there are episodes to hang on it: an empty
 * 自分史 should look like a form with blanks, not like a screen with nothing on
 * it. Blanks say what is missing; emptiness says nothing at all.
 */

/** The rungs, in order, as the timeline draws them. */
export const TIMELINE_PERIODS: EpisodePeriod[] = EPISODE_PERIODS.filter(
  (p) => p !== "不明",
);

/** Short forms, for where the full labels will not fit. */
export const PERIOD_SHORT: Record<EpisodePeriod, string> = {
  高校以前: "〜中学",
  高校: "高校",
  大学1年: "大1",
  大学2年: "大2",
  大学3年: "大3",
  大学4年: "大4",
  不明: "時期未設定",
};

export type PeriodBucket = {
  period: EpisodePeriod;
  episodes: Episode[];
};

/**
 * Every rung, in order, with whatever belongs on it.
 *
 * Empty buckets are kept — they are the point. 「不明」 is appended only when
 * something is actually in it, because an empty 時期未設定 row is a blank the
 * student cannot fill by talking, unlike all the others.
 */
export function bucketByPeriod(episodes: Episode[]): PeriodBucket[] {
  const buckets: PeriodBucket[] = TIMELINE_PERIODS.map((period) => ({
    period,
    episodes: episodes.filter((e) => e.period === period),
  }));

  const undated = episodes.filter((e) => e.period === "不明");
  if (undated.length > 0) buckets.push({ period: "不明", episodes: undated });

  return buckets;
}

/** How much of the 自分史 has something in it — what the home card reports. */
export function periodsFilled(episodes: Episode[]): {
  filled: EpisodePeriod[];
  total: number;
} {
  const filled = TIMELINE_PERIODS.filter((period) =>
    episodes.some((e) => e.period === period),
  );
  return { filled, total: TIMELINE_PERIODS.length };
}
