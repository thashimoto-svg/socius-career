"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/lib/firebase/auth-context";
import { listEpisodes } from "@/lib/firebase/episodes";
import { listSessions } from "@/lib/firebase/sessions";
import { formatShortDate, type Episode, type Session } from "@/lib/firebase/schema";
import { PERIOD_SHORT, periodsFilled, TIMELINE_PERIODS } from "@/lib/jibunshi-periods";
import { startChat } from "@/lib/new-chat";
import { T } from "@/lib/theme";

/**
 * What the 壁打ち has added up to.
 *
 * 履歴 used to hold this slot in the tabs, and a list of past conversations is
 * the one thing a student does not need a permanent tab for — it answers
 * "which one was that" and nothing else. What they cannot see anywhere is
 * whether any of this is going anywhere: how much has been kept, which parts of
 * their history are still blank, when they last did this at all. That is what
 * is here now (MTG 7/30). 履歴 moved to the drawer, which is where you look for
 * a specific conversation.
 */

type Summary = {
  episodes: Episode[];
  latest: Session | null;
};

export default function HomePage() {
  const router = useRouter();
  const { user, userDoc } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    Promise.all([listEpisodes(user.uid), listSessions(user.uid)])
      .then(([episodes, sessions]) => {
        if (cancelled) return;
        // listSessions is already newest-first.
        setSummary({ episodes, latest: sessions[0] ?? null });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const begin = async () => {
    if (!user || starting) return;
    setStarting(true);
    try {
      const id = await startChat(user.uid, {
        mode: summary?.latest?.mode ?? "counselor",
        profile: userDoc?.profile ?? null,
      });
      router.push(`/chat?s=${id}`);
    } catch {
      setStarting(false);
      setError(true);
    }
  };

  const episodes = summary?.episodes ?? [];
  const { filled, total } = periodsFilled(episodes);

  return (
    <>
      <AppHeader title="ホーム" newChatMode={summary?.latest?.mode ?? "counselor"} />

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 16px" }}>
        <p style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.9, margin: "0 0 14px" }}>
          {userDoc?.displayName ? `${userDoc.displayName}さんの` : ""}
          自分史は、話した分だけ埋まります。
        </p>

        {error && (
          <div
            role="alert"
            style={{
              marginBottom: 14,
              fontSize: 11.5,
              color: T.karakuchi,
              lineHeight: 1.9,
            }}
          >
            進み具合を読み込めませんでした。ページを再読み込みしてください。
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <StatCard
            label="残ったエピソード"
            value={summary ? String(episodes.length) : "—"}
            unit="件"
            href="/jibunshi"
            accent={T.gold}
            soft={T.goldSoft}
            valueColor="#8a6420"
          />
          <StatCard
            label="直近の壁打ち"
            value={
              summary ? (summary.latest ? formatShortDate(summary.latest.updatedAt) : "まだ") : "—"
            }
            unit={summary?.latest ? "" : ""}
            href="/history"
            accent={T.primary}
            soft={T.primarySoft}
            valueColor={T.primary}
          />
        </div>

        {/* 埋まった自分史の期間 — the blanks are the message. */}
        <Link
          href="/jibunshi"
          style={{
            display: "block",
            background: T.paper,
            border: `1px solid ${T.line}`,
            borderRadius: 14,
            padding: "13px 15px",
            marginBottom: 16,
            color: T.ink,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.sub }}>埋まった期間</div>
            <div style={{ fontSize: 11, color: T.sub }}>
              {summary ? `${filled.length} / ${total}` : "—"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {TIMELINE_PERIODS.map((period) => {
              const done = filled.includes(period);
              return (
                <div key={period} style={{ flex: 1, textAlign: "center" }}>
                  <div
                    aria-hidden="true"
                    style={{
                      height: 5,
                      borderRadius: 999,
                      background: done ? T.gold : T.line,
                    }}
                  />
                  <div
                    style={{
                      marginTop: 5,
                      fontSize: 9.5,
                      fontWeight: done ? 700 : 400,
                      color: done ? "#8a6420" : T.sub,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {PERIOD_SHORT[period]}
                  </div>
                </div>
              );
            })}
          </div>
        </Link>

        <button
          type="button"
          onClick={() => void begin()}
          disabled={starting}
          style={{
            width: "100%",
            padding: "13px 0",
            borderRadius: 13,
            border: "none",
            background: T.primary,
            color: "#fff",
            fontSize: 13.5,
            fontWeight: 700,
            opacity: starting ? 0.6 : 1,
            cursor: starting ? "default" : "pointer",
          }}
        >
          {starting ? "準備しています…" : "壁打ちを始める"}
        </button>

        {summary?.latest && (
          <Link
            href={`/chat?s=${summary.latest.id}`}
            style={{
              display: "block",
              marginTop: 8,
              padding: "10px 0",
              textAlign: "center",
              fontSize: 11.5,
              fontWeight: 700,
              color: T.primary,
            }}
          >
            前回の続きから({summary.latest.title})
          </Link>
        )}
      </div>
    </>
  );
}

/** One number, and where to go to see what is behind it. */
function StatCard({
  label,
  value,
  unit,
  href,
  accent,
  soft,
  valueColor,
}: {
  label: string;
  value: string;
  unit: string;
  href: string;
  accent: string;
  soft: string;
  valueColor: string;
}) {
  return (
    <Link
      href={href}
      style={{
        flex: 1,
        display: "block",
        background: soft,
        border: `1px solid ${accent}33`,
        borderRadius: 14,
        padding: "12px 14px",
        color: T.ink,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: T.sub }}>{label}</div>
      <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 3 }}>
        <span
          className="sc-display"
          style={{ fontSize: 22, fontWeight: 700, color: valueColor, lineHeight: 1.1 }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 11, color: T.sub }}>{unit}</span>}
      </div>
    </Link>
  );
}
