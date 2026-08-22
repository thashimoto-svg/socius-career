"use client";

import { useEffect, useRef, useState } from "react";
import { fieldFs, fs, T } from "@/lib/theme";

/**
 * Correcting one of the student's own turns, in the place it sits.
 *
 * Inline rather than a dialog, because the thing being corrected is a line in
 * a conversation and the only way to know whether the correction reads right
 * is to see it where the conversation is. A modal would cover the two lines
 * either side of it — which are the entire context for what needs fixing.
 *
 * What this deliberately does not do is regenerate anything. The reply that
 * followed stays exactly as it was: it is the record of what the AI actually
 * said, the student already read it, and rewriting it would be the app editing
 * a conversation that happened. The correction reaches the model on the next
 * turn instead, because the next request is built from the transcript.
 */

/** Same cap the transcript's create rule enforces (firestore.rules). */
const MESSAGE_MAX = 8000;

export function MessageEdit({
  text,
  saving,
  onSave,
  onCancel,
}: {
  text: string;
  saving: boolean;
  onSave: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(text);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.focus();
    // The caret goes to the end rather than selecting the lot: a correction is
    // usually a word inside a sentence the student wants to keep, unlike a
    // title, which is usually replaced whole.
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const save = () => {
    const next = draft.trim().slice(0, MESSAGE_MAX);
    // An emptied box is a delete, and delete is a different button with a
    // different confirmation. Nothing is written.
    if (!next || next === text) {
      onCancel();
      return;
    }
    onSave(next);
  };

  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
      <div style={{ width: "min(100%, 520px)" }}>
        <textarea
          ref={fieldRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          onKeyDown={(e) => {
            // No Enter-to-save here, on any device. The box being edited is
            // the one whose whole point is that it can hold 改行 — see the
            // composer, β報告 8/18 — and taking that key back the moment the
            // student wants to fix a line would be the same bug in a smaller
            // room.
            if (e.key === "Escape") onCancel();
          }}
          maxLength={MESSAGE_MAX}
          disabled={saving}
          aria-label="発言を編集"
          style={{
            width: "100%",
            minHeight: 64,
            padding: "10px 13px",
            borderRadius: 14,
            border: `1.5px solid ${T.primary}`,
            background: T.bg,
            color: T.ink,
            fontSize: fieldFs(13.5),
            lineHeight: 1.75,
            fontFamily: "inherit",
            outline: "none",
            resize: "none",
            overflow: "hidden",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
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
            onClick={save}
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
        <div style={{ marginTop: 6, fontSize: fs(10), color: T.sub, lineHeight: 1.7 }}>
          直しても、すでに返ってきたAIの返答は書き換わりません。次のやりとりから反映されます。
        </div>
      </div>
    </div>
  );
}

/**
 * 「この発言を削除しますか?」
 *
 * A dialog, unlike the edit above, because there is nothing to look at while
 * deciding — the question is not "does this read right" but "am I sure", and
 * the answer to the second one is worth interrupting for. The reply that
 * followed goes too, and the copy says so: a question left standing over a
 * transcript that no longer contains what prompted it reads as the app talking
 * to itself, and it is what the next request would be built from.
 */
export function MessageDeleteDialog({
  withReply,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  withReply: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <>
      <div
        className="sc-scrim"
        onClick={() => !busy && onCancel()}
        aria-hidden="true"
        style={{ position: "fixed", inset: 0, background: T.scrim, zIndex: 70 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-msg-delete-title"
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
          id="sc-msg-delete-title"
          className="sc-display"
          style={{ fontSize: fs(13.5), fontWeight: 700, color: T.ink, lineHeight: 1.7 }}
        >
          この発言を削除しますか?
        </div>
        <div style={{ fontSize: fs(11.5), color: T.sub, lineHeight: 1.8, marginTop: 8 }}>
          {withReply
            ? "直後のAIの返答も一緒に削除されます。抽出済みの自分史エピソードは削除されません。"
            : "抽出済みの自分史エピソードは削除されません。"}
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
            onClick={onCancel}
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
            onClick={onConfirm}
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
  );
}
