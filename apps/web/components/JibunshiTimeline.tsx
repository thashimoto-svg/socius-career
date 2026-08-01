"use client";

import type { PeriodBucket } from "@/lib/jibunshi-periods";
import { T } from "@/lib/theme";

/**
 * The 自分史 as a shape before it is a list.
 *
 * The card list only ever showed what was already there, so a student with two
 * episodes saw two cards and no sign that anything was missing. The timeline
 * draws every period whether or not it has anything in it — 高校 through 大学4年
 * are printed as blanks from the first visit. Blanks are an instruction; an
 * empty screen is not.
 *
 * Tapping an entry goes to that card rather than expanding here. The timeline
 * is for finding your way around; the card is where the student's own words
 * are, and they should not have to be read twice in two places.
 */

type JibunshiTimelineProps = {
  buckets: PeriodBucket[];
  onPick: (episodeId: string) => void;
  /** Suppresses the "まだありません" lines while the first read is in flight. */
  loading: boolean;
};

export function JibunshiTimeline({ buckets, onPick, loading }: JibunshiTimelineProps) {
  return (
    <ol
      aria-label="年表"
      style={{ listStyle: "none", margin: "0 0 22px", padding: 0, position: "relative" }}
    >
      {/* The rail. Behind the dots, stopping at the last one rather than
          running off the end of the list. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 4.5,
          top: 8,
          bottom: 14,
          width: 1.5,
          background: T.line,
        }}
      />

      {buckets.map((bucket) => {
        const filled = bucket.episodes.length > 0;
        return (
          <li
            key={bucket.period}
            style={{ position: "relative", paddingLeft: 22, paddingBottom: 14 }}
          >
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 0,
                top: 4,
                width: 10,
                height: 10,
                borderRadius: 999,
                background: filled ? T.gold : T.paper,
                border: `1.5px solid ${filled ? T.gold : T.line}`,
              }}
            />

            <div
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                color: filled ? T.ink : T.sub,
                marginBottom: filled ? 6 : 3,
              }}
            >
              {bucket.period}
            </div>

            {filled ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {bucket.episodes.map((episode) => (
                  <button
                    key={episode.id}
                    type="button"
                    onClick={() => onPick(episode.id)}
                    style={{
                      maxWidth: "100%",
                      textAlign: "left",
                      padding: "6px 11px",
                      borderRadius: 10,
                      border: `1px solid ${T.gold}`,
                      background: T.goldSoft,
                      color: "#8a6420",
                      fontSize: 11.5,
                      fontWeight: 700,
                      lineHeight: 1.5,
                      cursor: "pointer",
                    }}
                  >
                    {episode.title}
                  </button>
                ))}
              </div>
            ) : (
              !loading && (
                <div style={{ fontSize: 10.5, color: T.sub }}>
                  {bucket.period === "不明"
                    ? "時期が分かっていない出来事"
                    : "この時期の話はまだありません"}
                </div>
              )
            )}
          </li>
        );
      })}
    </ol>
  );
}
