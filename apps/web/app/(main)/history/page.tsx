"use client";

import { useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import {
  SessionRenameButton,
  SessionTitleEdit,
} from "@/components/SessionTitleEdit";
import { ScreenError, ScreenLoading } from "@/components/screen-state";
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

  const [editing, setEditing] = useState<string | null>(null);
  /**
   * Names changed since this screen read the list.
   *
   * The screen loads once and stays put, so a renamed row has to take its new
   * name from somewhere other than a re-read — and a re-read would also
   * reshuffle nothing and cost a query to prove it.
   */
  const [renamed, setRenamed] = useState<Record<string, string>>({});

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

      {sessions?.length === 0 && (
        <div style={{ fontSize: fs(12.5), color: T.sub, lineHeight: 1.9 }}>
          まだ記録はありません。
          <br />
          <Link href="/chat" style={{ color: T.primary, fontWeight: 700 }}>
            最初の壁打ちを始める
          </Link>
        </div>
      )}

      {sessions?.map((s) => {
        const title = renamed[s.id] ?? s.title;

        if (editing === s.id && user) {
          return (
            <div key={s.id} style={{ marginBottom: 10 }}>
              <SessionTitleEdit
                uid={user.uid}
                sessionId={s.id}
                title={title}
                onRenamed={(next) => {
                  setRenamed((prev) => ({ ...prev, [s.id]: next }));
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            </div>
          );
        }

        return (
          // The card and its ✎ are siblings: the card is a link, and a button
          // inside a link is one target rather than two.
          <div key={s.id} style={{ position: "relative", marginBottom: 10 }}>
        <Link
          href={`/chat?s=${s.id}`}
          // Every row points at the same screen with a different 壁打ち in the
          // query, so the automatic prefetch is one request per row — up to
          // fifty of them, on a phone, for a list where the student is going to
          // open exactly one. The route itself is already in the bundle; what
          // the prefetch buys is nothing, and what it costs is the list feeling
          // slow to scroll.
          prefetch={false}
          className="sc-fade"
          style={{
            display: "block",
            background: T.paper,
            border: `1px solid ${T.line}`,
            borderRadius: 14,
            // Right side left clear for the ✎ so the date never runs under it.
            padding: "13px 46px 13px 15px",
            color: T.ink,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <div style={{ fontSize: fs(13.5), fontWeight: 700 }}>{title}</div>
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
        <SessionRenameButton title={title} onClick={() => setEditing(s.id)} />
          </div>
        );
      })}
      </div>
    </>
  );
}
