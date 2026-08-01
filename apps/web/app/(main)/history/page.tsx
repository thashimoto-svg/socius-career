"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/lib/firebase/auth-context";
import { listSessions } from "@/lib/firebase/sessions";
import { formatShortDate, type Session } from "@/lib/firebase/schema";
import { fs, T } from "@/lib/theme";

// Sessions are saved automatically; tapping one resumes it, so a conversation
// is never consumed in a single sitting.
export default function HistoryPage() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    listSessions(user.uid)
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <>
      <AppHeader title="壁打ちの記録" />
      {/* The shell no longer scrolls, so every screen owns the panel that does. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 16px" }}>

      {error && (
        <div role="alert" style={{ fontSize: fs(12), color: T.karakuchi, lineHeight: 1.9 }}>
          記録を読み込めませんでした。ページを再読み込みしてください。
        </div>
      )}

      {!error && sessions === null && (
        <div style={{ fontSize: fs(12), color: T.sub }}>読み込んでいます…</div>
      )}

      {!error && sessions?.length === 0 && (
        <div style={{ fontSize: fs(12.5), color: T.sub, lineHeight: 1.9 }}>
          まだ記録はありません。
          <br />
          <Link href="/chat" style={{ color: T.primary, fontWeight: 700 }}>
            最初の壁打ちを始める
          </Link>
        </div>
      )}

      {sessions?.map((s) => (
        <Link
          key={s.id}
          href={`/chat?s=${s.id}`}
          className="sc-fade"
          style={{
            display: "block",
            background: T.paper,
            border: `1px solid ${T.line}`,
            borderRadius: 14,
            padding: "13px 15px",
            marginBottom: 10,
            color: T.ink,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: fs(13.5), fontWeight: 700 }}>{s.title}</div>
            <div style={{ fontSize: fs(11), color: T.sub }}>{formatShortDate(s.updatedAt)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 7, alignItems: "center" }}>
            <span style={{ fontSize: fs(10.5), color: T.sub }}>{s.turnCount}往復</span>
            {s.episodeCount > 0 ? (
              <span
                style={{
                  fontSize: fs(10.5),
                  color: T.goldInk,
                  background: T.goldSoft,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontWeight: 700,
                }}
              >
                自分史に{s.episodeCount}件
              </span>
            ) : (
              <span
                style={{
                  fontSize: fs(10.5),
                  color: T.primary,
                  background: T.primarySoft,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontWeight: 700,
                }}
              >
                {s.status === "closed" ? "終了しました" : "途中から再開できます"}
              </span>
            )}
          </div>
        </Link>
      ))}
      </div>
    </>
  );
}
