"use client";

import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { ScreenError, ScreenLoading } from "@/components/screen-state";
import { SessionDeleteButton, useSessionDelete } from "@/components/session-delete";
import { useAuth } from "@/lib/firebase/auth-context";
import { listSessions } from "@/lib/firebase/sessions";
import { formatShortDate } from "@/lib/firebase/schema";
import { useLoadable } from "@/lib/use-loadable";
import { fs, T } from "@/lib/theme";

// Sessions are saved automatically; tapping one resumes it, so a conversation
// is never consumed in a single sitting.
export default function HistoryPage() {
  const { user } = useAuth();
  const {
    data: sessions,
    error,
    loading,
    retry,
  } = useLoadable(user?.uid ?? null, listSessions, {
    message: "記録を読み込めませんでした。",
  });

  // A deleted row goes the moment it is gone, without waiting for a re-read —
  // this screen loads once and stays put.
  const { deletedIds } = useSessionDelete();
  const rows = sessions?.filter((s) => !deletedIds.has(s.id)) ?? null;

  return (
    <>
      <AppHeader title="壁打ちの記録" />
      {/* The shell no longer scrolls, so every screen owns the panel that does. */}
      <div
        className="sc-readable"
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 16px" }}
      >

      {error && <ScreenError message={error} onRetry={retry} />}

      {loading && <ScreenLoading />}

      {rows?.length === 0 && (
        <div style={{ fontSize: fs(12.5), color: T.sub, lineHeight: 1.9 }}>
          まだ記録はありません。
          <br />
          <Link href="/chat" style={{ color: T.primary, fontWeight: 700 }}>
            最初の壁打ちを始める
          </Link>
        </div>
      )}

      {rows?.map((s) => (
        // The card and its 🗑 are siblings: the card is a link, and a button
        // inside a link is one target rather than two.
        <div key={s.id} style={{ position: "relative", marginBottom: 10 }}>
        <Link
          href={`/chat?s=${s.id}`}
          className="sc-fade"
          style={{
            display: "block",
            background: T.paper,
            border: `1px solid ${T.line}`,
            borderRadius: 14,
            // Right side left clear for the 🗑 so the date never runs under it.
            padding: "13px 46px 13px 15px",
            color: T.ink,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <div style={{ fontSize: fs(13.5), fontWeight: 700 }}>{s.title}</div>
            <div style={{ fontSize: fs(11), color: T.sub, flexShrink: 0 }}>
              {formatShortDate(s.updatedAt)}
            </div>
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
        {/* No `current` here: 履歴 is not a 壁打ち, so nothing on this screen is
            the conversation being deleted. */}
        <SessionDeleteButton sessionId={s.id} title={s.title} />
        </div>
      ))}
      </div>
    </>
  );
}
