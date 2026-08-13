"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Toast, TOAST_MS } from "@/components/toast";
import { useAuth } from "@/lib/firebase/auth-context";
import { abandonExtraction } from "@/lib/extraction";
import { deleteSession } from "@/lib/firebase/sessions";
import { fs, T } from "@/lib/theme";

/**
 * Throwing away a 壁打ち, from any of the three places that list them.
 *
 * All three — the drawer, the 履歴 screen, the desktop sidebar — show the same
 * rows and would otherwise each grow their own copy of the confirmation, the
 * in-flight state, and the question of where to send a student who just deleted
 * the conversation they were reading. So the rows only render a button, and
 * everything that follows the tap happens here.
 *
 * Above the pages for the same reason extraction is: deleting the open 壁打ち
 * navigates away from it, and the toast that says it worked has to outlive the
 * screen that asked.
 *
 * What this must never do is touch the 自分史. 壁打ち is the process and 自分史
 * is the asset — an episode extracted from a conversation survives the
 * conversation, which is why the confirmation says so out loud rather than
 * leaving the student to guess how much they are about to lose.
 */

type DeleteRequest = {
  id: string;
  title: string;
  /** True when this is the 壁打ち on screen; deleting it has to move them off it. */
  current?: boolean;
  /** Run once it is actually gone. The drawer closes itself with this. */
  onDeleted?: () => void;
};

type SessionDeleteValue = {
  /** Ask to delete one. Opens the confirmation; nothing is written until it is answered. */
  requestDelete: (req: DeleteRequest) => void;
  /**
   * What has been deleted in this tab.
   *
   * Each list holds its own copy of what it read, and a delete from one of them
   * has to empty the row in all of them without a re-read — the sidebar is
   * permanent furniture and would otherwise keep a dead row until the next
   * navigation.
   */
  deletedIds: ReadonlySet<string>;
  /** The one being deleted right now, whose controls are disabled. */
  deletingId: string | null;
  /**
   * Whether the confirmation is up.
   *
   * The drawer closes itself on Escape, and it is the surface most of these are
   * raised from — so without somewhere to read this, one press of Escape would
   * answer the dialog and take the drawer behind it away at the same time.
   */
  confirming: boolean;
};

const SessionDeleteContext = createContext<SessionDeleteValue | null>(null);

export function useSessionDelete(): SessionDeleteValue {
  const ctx = useContext(SessionDeleteContext);
  if (!ctx) throw new Error("useSessionDelete must be used inside <SessionDeleteProvider>");
  return ctx;
}

export function SessionDeleteProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const [target, setTarget] = useState<DeleteRequest | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  const requestDelete = useCallback((req: DeleteRequest) => {
    setError(null);
    setTarget(req);
  }, []);

  const cancel = useCallback(() => {
    if (deletingId) return;
    setTarget(null);
    setError(null);
  }, [deletingId]);

  const confirmDelete = async () => {
    if (!user || !target || deletingId) return;
    setDeletingId(target.id);
    setError(null);

    // Before the first document is touched, not after: extraction is triggered
    // by leaving a 壁打ち, and this is about to leave one. A run that started
    // between here and the delete would finish by writing to the session
    // document being removed.
    abandonExtraction(target.id);

    try {
      await deleteSession(user.uid, target.id);
    } catch (e) {
      console.error("[session] 削除に失敗しました", e);
      // The dialog stays open with the reason in it. A toast would take the
      // 削除する button away with it, and trying again is the whole response
      // to this failure.
      setError("削除できませんでした。通信状況を確認して、もう一度お試しください。");
      setDeletingId(null);
      return;
    }

    setDeletedIds((prev) => new Set(prev).add(target.id));
    setDeletingId(null);
    setTarget(null);
    setToast({ id: Date.now(), text: "壁打ちの記録を削除しました" });
    target.onDeleted?.();

    if (target.current) {
      // /chat without ?s= is where a 壁打ち starts: it picks up the most recent
      // unfinished conversation, or opens a new one when there is none. Minting
      // a fresh session here instead would leave an empty thread — and spend an
      // opening line on it — every time a student tidied up.
      //
      // replace, not push: the URL of a session that no longer exists must not
      // be one the back button can return to.
      router.replace("/chat");
    }
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, cancel]);

  const value = useMemo(
    () => ({ requestDelete, deletedIds, deletingId, confirming: target !== null }),
    [requestDelete, deletedIds, deletingId, target],
  );

  const busy = deletingId !== null;

  return (
    <SessionDeleteContext.Provider value={value}>
      {children}

      {target && (
        <>
          <div
            className="sc-scrim"
            onClick={cancel}
            aria-hidden="true"
            style={{ position: "fixed", inset: 0, background: T.scrim, zIndex: 70 }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sc-delete-title"
            className="sc-fade"
            style={{
              position: "fixed",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 71,
              width: "min(360px, calc(100% - 40px))",
              background: T.paper,
              border: `1px solid ${T.line}`,
              borderRadius: 16,
              padding: "18px 18px 14px",
              boxShadow: `0 10px 30px ${T.shadow}`,
            }}
          >
            <div
              id="sc-delete-title"
              className="sc-display"
              style={{ fontSize: fs(13.5), fontWeight: 700, color: T.ink, lineHeight: 1.7 }}
            >
              この壁打ちの記録を削除しますか?
            </div>
            {/* The reassurance is the point of having a dialog at all: without
                it the student has to decide whether 削除 also means losing the
                自分史 they have built, and the safe guess is not to press it. */}
            <div
              style={{
                fontSize: fs(11.5),
                color: T.sub,
                lineHeight: 1.8,
                marginTop: 8,
              }}
            >
              抽出済みの自分史エピソードは削除されません。
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  padding: "8px 11px",
                  borderRadius: 10,
                  background: T.karakuchiSoft,
                  color: T.karakuchi,
                  fontSize: fs(11),
                  lineHeight: 1.7,
                }}
              >
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={cancel}
                disabled={busy}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  borderRadius: 10,
                  border: `1.5px solid ${T.line}`,
                  background: T.paper,
                  color: T.sub,
                  fontSize: fs(11.5),
                  fontWeight: 700,
                  opacity: busy ? 0.5 : 1,
                  cursor: busy ? "default" : "pointer",
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={busy}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  borderRadius: 10,
                  border: "none",
                  background: T.karakuchi,
                  color: T.onAccent,
                  fontSize: fs(11.5),
                  fontWeight: 700,
                  opacity: busy ? 0.6 : 1,
                  cursor: busy ? "default" : "pointer",
                }}
              >
                {busy ? "削除しています…" : "削除する"}
              </button>
            </div>
          </div>
        </>
      )}

      {toast && <Toast key={toast.id} tone="info">{toast.text}</Toast>}
    </SessionDeleteContext.Provider>
  );
}

/**
 * The 🗑 on a row in any of the three lists.
 *
 * An explicit icon rather than a swipe or a long press (per the 8/13 spec):
 * both of those are gestures a student makes by accident while scrolling a list
 * on a phone, and the thing on the other side of the accident is a conversation
 * they cannot get back. It sits at the right edge, away from the title the row
 * is tapped by, and the row is padded so nothing runs underneath it.
 *
 * Positioned absolutely, so every list only has to make its row `relative`.
 * It has to be a sibling of the row's own button or link, never a child of it —
 * a button inside a button is not something the browser will render as two
 * separate targets.
 */
export function SessionDeleteButton({
  sessionId,
  title,
  current,
  onDeleted,
}: {
  sessionId: string;
  title: string;
  current?: boolean;
  onDeleted?: () => void;
}) {
  const { requestDelete, deletingId } = useSessionDelete();
  const busy = deletingId === sessionId;

  return (
    <button
      type="button"
      onClick={() => requestDelete({ id: sessionId, title, current, onDeleted })}
      disabled={busy}
      aria-label={`「${title}」の記録を削除する`}
      style={{
        position: "absolute",
        right: 4,
        top: "50%",
        transform: "translateY(-50%)",
        width: 34,
        height: 34,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        borderRadius: 9,
        background: "none",
        color: T.sub,
        opacity: busy ? 0.4 : 1,
        cursor: busy ? "default" : "pointer",
      }}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M6.3 1.6h3.4l.55 1.1H13.2v1.35H2.8V2.7h2.95l.55-1.1ZM4 5.4h8v7.5c0 .83-.67 1.5-1.5 1.5h-5A1.5 1.5 0 0 1 4 12.9V5.4Zm2.15 1.7v6.1h1.3V7.1h-1.3Zm2.4 0v6.1h1.3V7.1h-1.3Z"
        />
      </svg>
    </button>
  );
}
