"use client";

import { useEffect, useRef, useState } from "react";
import { renameSession, TITLE_MAX_LENGTH } from "@/lib/firebase/sessions";
import { fieldFs, fs, T } from "@/lib/theme";

/**
 * Renaming a 壁打ち, from the row it is listed on.
 *
 * The generated title comes from the student's first message, which is the
 * best guess available for free and is still only a guess — a conversation
 * that started with 「バイトの話」 and spent an hour on the person they fell out
 * with there is filed under the wrong name forever. This is the way out of
 * that, and it is the reason the generator is allowed to stay a set of rules
 * rather than a model call: a title that came out wrong has an answer now.
 *
 * In the 履歴 list rather than in the 壁打ち itself, because renaming is
 * something you do while looking at the list you are trying to tell apart.
 */
export function SessionTitleEdit({
  uid,
  sessionId,
  title,
  onRenamed,
  onCancel,
}: {
  uid: string;
  sessionId: string;
  title: string;
  onRenamed: (title: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.focus();
    // Selected rather than left with the caret at one end: most renames
    // replace the title outright, and the ones that do not still have both
    // ends one arrow key away.
    el.select();
  }, []);

  const save = async () => {
    const next = draft.trim().slice(0, TITLE_MAX_LENGTH);
    // An emptied box is not a title. Nothing is written and the row goes back
    // to the name it had, which is a better answer than 「無題」.
    if (!next || next === title) {
      onCancel();
      return;
    }

    setSaving(true);
    setError(false);
    try {
      await renameSession(uid, sessionId, next);
      onRenamed(next);
    } catch (e) {
      console.error("[session] 名前を変更できませんでした", e);
      setError(true);
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        background: T.paper,
        border: `1px solid ${T.line}`,
        borderRadius: 14,
        padding: "13px 15px",
      }}
    >
      <input
        ref={fieldRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          // Escape leaves it as it was. The row is inside a list the student
          // was scrolling; getting out of an edit they opened by mistake
          // should not need aim.
          if (e.key === "Escape") onCancel();
        }}
        maxLength={TITLE_MAX_LENGTH}
        disabled={saving}
        aria-label="壁打ちの名前"
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 9,
          border: `1.5px solid ${T.primary}`,
          background: T.bg,
          color: T.ink,
          fontSize: fieldFs(13),
          fontWeight: 700,
          fontFamily: "inherit",
          outline: "none",
        }}
      />

      {error && (
        <div
          role="alert"
          style={{ marginTop: 8, fontSize: fs(10.5), color: T.karakuchi, lineHeight: 1.7 }}
        >
          名前を変更できませんでした。通信状況を確認して、もう一度お試しください。
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{
            padding: "7px 16px",
            borderRadius: 9,
            border: `1.5px solid ${T.line}`,
            background: T.paper,
            color: T.sub,
            fontSize: fs(11),
            fontWeight: 700,
            opacity: saving ? 0.5 : 1,
            cursor: saving ? "default" : "pointer",
          }}
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          style={{
            padding: "7px 18px",
            borderRadius: 9,
            border: "none",
            background: T.primary,
            color: T.onAccent,
            fontSize: fs(11),
            fontWeight: 700,
            opacity: saving ? 0.6 : 1,
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "保存しています…" : "保存"}
        </button>
      </div>
    </div>
  );
}

/**
 * The ✎ on a row.
 *
 * A sibling of the row's link, never a child of it — a button inside a link is
 * one target rather than two. Positioned absolutely, so the list only has to
 * make its rows `relative` and pad the right edge clear.
 *
 * `right` exists because a row can carry more than one of these. 履歴 puts the
 * 🗑 at the edge and this one beside it; the offset belongs to the list, which
 * is the only place that knows what else is on the row.
 */
export function SessionRenameButton({
  title,
  onClick,
  right = 6,
}: {
  title: string;
  onClick: () => void;
  /** Distance from the row's right edge. */
  right?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`「${title}」の名前を変更する`}
      style={{
        position: "absolute",
        right,
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
        cursor: "pointer",
      }}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M11.4 1.6a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2l-.9.9-3-3 .9-.9ZM9.6 3.4l3 3-6.5 6.5-3.6.6.6-3.6 6.5-6.5Z"
        />
      </svg>
    </button>
  );
}
