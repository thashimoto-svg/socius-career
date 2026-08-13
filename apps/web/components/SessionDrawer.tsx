"use client";

import { useEffect } from "react";
import { ScreenError, ScreenLoading } from "@/components/screen-state";
import { SessionDeleteButton, useSessionDelete } from "@/components/session-delete";
import { listSessions } from "@/lib/firebase/sessions";
import { formatShortDate } from "@/lib/firebase/schema";
import { useLoadable } from "@/lib/use-loadable";
import { fs, T } from "@/lib/theme";

type SessionDrawerProps = {
  onClose: () => void;
  uid: string;
  /** Highlighted in the list so the student can see where they are. */
  currentSessionId: string | null;
  onSelect: (sessionId: string) => void;
  /**
   * Starts a 壁打ち in the tone the student is already talking in. Picking a
   * different one is the header menu's job now (MTG 7/30) — asking here as
   * well would make every new conversation a two-step decision, and the
   * question was being answered by whoever guessed fastest.
   */
  onNewSession: () => void;
  creating: boolean;
};

/**
 * Past 壁打ち, reachable from inside the conversation.
 *
 * 履歴 in the bottom tabs already lists these, but leaving the chat screen to
 * switch conversations is the wrong shape for it: 「対話が単発で消費されない」
 * means moving between threads should feel like part of the 壁打ち, not like
 * navigating away from it. Both routes stay.
 *
 * Mounted only while it is open, which is what makes each open a fresh read: a
 * session's title and updatedAt change as the student talks, so a list left
 * over from the last open would be stale.
 */
export function SessionDrawer({
  onClose,
  uid,
  currentSessionId,
  onSelect,
  onNewSession,
  creating,
}: SessionDrawerProps) {
  // Loaded the same way every screen loads its data. This used to be a bare
  // listSessions() with a .catch, which is the shape that cannot recover from
  // the failure that actually happens: an unreachable backend leaves the
  // promise unsettled rather than rejecting it, so the catch never runs and
  // 「読み込んでいます…」 stays on screen with no way out of it.
  const {
    data: sessions,
    error,
    loading,
    retry,
  } = useLoadable(uid, listSessions, { message: "記録を読み込めませんでした。" });

  // What was read a moment ago, minus anything deleted since. The drawer is
  // mounted fresh on every open, so this only matters for a delete made from
  // the drawer itself — which is where most of them are made.
  const { deletedIds, confirming } = useSessionDelete();
  const rows = sessions?.filter((s) => !deletedIds.has(s.id)) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while the delete confirmation is up. Both listen on the window, so
      // one press would otherwise answer the dialog and close the drawer it is
      // standing on at the same time.
      if (e.key === "Escape" && !confirming) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirming]);

  return (
    <>
      <div
        className="sc-scrim"
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: T.scrim,
          zIndex: 40,
        }}
      />

      <div
        className="sc-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="壁打ちの一覧"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: "80%",
          maxWidth: 300,
          background: T.paper,
          borderRight: `1px solid ${T.line}`,
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            // The drawer is fixed to the viewport, so it reaches into the notch
            // that the header below it is padded out of.
            padding: "calc(env(safe-area-inset-top, 0px) + 14px) 14px 10px",
            borderBottom: `1px solid ${T.line}`,
          }}
        >
          <div className="sc-display" style={{ fontSize: fs(15), fontWeight: 700 }}>
            壁打ちの記録
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            style={{
              border: "none",
              background: "none",
              color: T.sub,
              fontSize: fs(17),
              lineHeight: 1,
              padding: 4,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: "12px 12px 8px" }}>
          <button
            type="button"
            // Wrapped, not passed straight through: onClick would hand the
            // mouse event to a function whose first parameter is the tone.
            onClick={() => onNewSession()}
            disabled={creating}
            style={{
              width: "100%",
              padding: "10px 0",
              borderRadius: 11,
              border: `1.5px solid ${T.primary}`,
              background: T.primarySoft,
              color: T.primary,
              fontSize: fs(12.5),
              fontWeight: 700,
              opacity: creating ? 0.6 : 1,
              cursor: creating ? "default" : "pointer",
            }}
          >
            {creating ? "準備しています…" : "＋ 新しい壁打ち"}
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "4px 12px calc(env(safe-area-inset-bottom, 0px) + 16px)",
          }}
        >
          {error && <ScreenError message={error} onRetry={retry} />}

          {loading && <ScreenLoading />}

          {rows?.length === 0 && (
            <div style={{ fontSize: fs(11.5), color: T.sub, lineHeight: 1.9 }}>
              まだ記録はありません。
            </div>
          )}

          {rows?.map((s) => {
            const current = s.id === currentSessionId;
            return (
              // The row and its 🗑 are siblings inside this box rather than one
              // inside the other — nesting them would be a button inside a
              // button, which is one target, not two.
              <div key={s.id} style={{ position: "relative", marginBottom: 7 }}>
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  aria-current={current ? "true" : undefined}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    // Right side left clear for the 🗑, so the title never runs
                    // under it and the two are not one ambiguous tap.
                    padding: "10px 44px 10px 11px",
                    borderRadius: 11,
                    border: `1px solid ${current ? T.primary : T.line}`,
                    background: current ? T.primarySoft : T.paper,
                    color: T.ink,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      fontSize: fs(12.5),
                      fontWeight: 700,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.title}
                  </div>
                  <div style={{ fontSize: fs(10.5), color: T.sub, marginTop: 4 }}>
                    {formatShortDate(s.updatedAt)}・{s.turnCount}往復
                  </div>
                </button>
                <SessionDeleteButton
                  sessionId={s.id}
                  title={s.title}
                  current={current}
                  // Deleting the 壁打ち on screen sends the student back to
                  // /chat; leaving the drawer open over where they land would
                  // hide the thing they were moved to.
                  onDeleted={current ? onClose : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
