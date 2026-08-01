"use client";

import { useEffect, useState } from "react";
import type { ChatMode } from "@/lib/firebase/schema";
import { T } from "@/lib/theme";

/**
 * The style switch, in the header where the student can find it.
 *
 * It used to be offered once, buried in the drawer behind 「＋ 新しい壁打ち」,
 * and shown afterwards as a read-only label. Nobody found it, and the ones who
 * did could not tell what they had picked apart from what they hadn't
 * (MTG 7/30). It is a menu now — the current tone is always on screen, and
 * changing it is one tap away.
 *
 * Changing it still cannot happen inside a conversation. The transcript sent
 * back to the model would mix two tones, and the history would no longer match
 * the instruction that produced it. So the switch starts a new 壁打ち, and says
 * so before it does.
 */

export const TONE_LABELS: Record<ChatMode, string> = {
  counselor: "じっくり",
  karakuchi: "ストレート",
};

const TONE_HINTS: Record<ChatMode, string> = {
  counselor: "受け止めてから、ひとつ聞かれる",
  karakuchi: "前置きなしで、端的に聞かれる",
};

const TONES: ChatMode[] = ["counselor", "karakuchi"];

const accentOf = (mode: ChatMode) => (mode === "karakuchi" ? T.karakuchi : T.primary);
const softOf = (mode: ChatMode) =>
  mode === "karakuchi" ? T.karakuchiSoft : T.primarySoft;

type ToneMenuProps = {
  mode: ChatMode;
  /** True while a new 壁打ち is being created, so the switch cannot fire twice. */
  busy: boolean;
  onSwitch: (mode: ChatMode) => void;
};

export function ToneMenu({ mode, busy, onSwitch }: ToneMenuProps) {
  const [open, setOpen] = useState(false);
  // The tone the student picked, held until they say yes to starting over.
  const [pending, setPending] = useState<ChatMode | null>(null);

  useEffect(() => {
    if (!open && !pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPending(null);
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending]);

  const choose = (next: ChatMode) => {
    setOpen(false);
    // Picking the tone you are already in is not a change, and must not throw
    // away the conversation to grant it.
    if (next === mode) return;
    setPending(next);
  };

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`話し方: ${TONE_LABELS[mode]}。変更する`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 9px",
          borderRadius: 999,
          border: `1.5px solid ${accentOf(mode)}`,
          background: softOf(mode),
          color: accentOf(mode),
          fontSize: 10.5,
          fontWeight: 700,
          opacity: busy ? 0.5 : 1,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {TONE_LABELS[mode]}
        <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true" focusable="false">
          <path d="M0 0h8L4 5z" fill={accentOf(mode)} />
        </svg>
      </button>

      {open && (
        <>
          <div
            className="sc-scrim"
            onClick={() => setOpen(false)}
            aria-hidden="true"
            style={{ position: "fixed", inset: 0, zIndex: 30 }}
          />
          <div
            role="menu"
            aria-label="話し方"
            className="sc-fade"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 31,
              width: 214,
              padding: 6,
              borderRadius: 12,
              border: `1px solid ${T.line}`,
              background: T.paper,
              boxShadow: "0 10px 28px rgba(34, 48, 47, 0.16)",
            }}
          >
            {TONES.map((tone) => {
              const current = tone === mode;
              return (
                <button
                  key={tone}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  onClick={() => choose(tone)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 9,
                    border: "none",
                    background: current ? softOf(tone) : "transparent",
                    color: current ? accentOf(tone) : T.ink,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {TONE_LABELS[tone]}
                  {current && "(いま話している方)"}
                  <span
                    style={{
                      display: "block",
                      marginTop: 3,
                      fontSize: 10,
                      fontWeight: 400,
                      color: T.sub,
                    }}
                  >
                    {TONE_HINTS[tone]}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {pending && (
        <>
          <div
            className="sc-scrim"
            onClick={() => setPending(null)}
            aria-hidden="true"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(34, 48, 47, 0.38)",
              zIndex: 50,
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="話し方の変更"
            className="sc-fade"
            style={{
              position: "fixed",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 51,
              width: "min(320px, calc(100% - 40px))",
              padding: "18px 18px 14px",
              borderRadius: 16,
              background: T.paper,
              border: `1px solid ${T.line}`,
              boxShadow: "0 16px 40px rgba(34, 48, 47, 0.22)",
            }}
          >
            <div className="sc-display" style={{ fontSize: 14, fontWeight: 700 }}>
              {TONE_LABELS[pending]}に切り替えますか?
            </div>
            <p style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.9, margin: "8px 0 14px" }}>
              新しいチャットを開始します
              <br />
              (現在の会話は履歴に保存されます)
            </p>

            <button
              type="button"
              onClick={() => {
                const next = pending;
                setPending(null);
                onSwitch(next);
              }}
              disabled={busy}
              style={{
                width: "100%",
                padding: "10px 0",
                borderRadius: 11,
                border: "none",
                background: accentOf(pending),
                color: "#fff",
                fontSize: 12.5,
                fontWeight: 700,
                opacity: busy ? 0.6 : 1,
                cursor: busy ? "default" : "pointer",
              }}
            >
              {busy ? "準備しています…" : "新しい壁打ちを始める"}
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              style={{
                width: "100%",
                marginTop: 6,
                padding: "8px 0",
                borderRadius: 11,
                border: "none",
                background: "none",
                color: T.sub,
                fontSize: 11.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              やめる
            </button>
          </div>
        </>
      )}
    </div>
  );
}
