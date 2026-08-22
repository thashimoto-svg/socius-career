"use client";

import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { fs, T } from "@/lib/theme";

/**
 * What the student can do to something they said.
 *
 * A row of small text buttons under their own bubble, not a long press. A long
 * press on a phone is what selecting text is, and a list of conversation
 * bubbles is a list of things people select text in — attaching a menu to that
 * gesture means either taking selection away or racing it. It is also
 * invisible: nothing on screen says the gesture exists, so the students who
 * would use it are exactly the ones who already assumed it was there.
 *
 * Set in T.sub at the smallest size in the app, because these are for the
 * moment the student wants them and should be furniture the rest of the time.
 * The transcript is what they came to read.
 */

/** How long 「コピーしました」 stays before the button says コピー again. */
const COPIED_MS = 1600;

export function MessageActions({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 2,
        // Pulled up under the bubble it belongs to, which carries the 10px
        // gap meant for the space between two messages.
        margin: "-6px 0 10px",
      }}
    >
      {children}
    </div>
  );
}

export function MessageActionButton({
  onClick,
  label,
  disabled,
  tone = "sub",
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  /** 「削除」 is the one that cannot be undone, and it is coloured like it. */
  tone?: "sub" | "warn";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        // Padding rather than a width: the tap target has to clear 30px on a
        // phone, and these labels are two Japanese characters wide.
        padding: "6px 9px",
        border: "none",
        borderRadius: 8,
        background: "none",
        color: tone === "warn" ? T.karakuchi : T.sub,
        fontSize: fs(10.5),
        fontWeight: 700,
        lineHeight: 1.4,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

/**
 * 「コピー」 — the whole message, not the part that fits on screen.
 *
 * Its own component because the confirmation lives in the button: a toast for
 * something this small would cover the conversation to report on a thing that
 * already visibly happened, and the student is usually about to paste it
 * somewhere else anyway.
 */
export function CopyMessageButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <>
      <MessageActionButton
        onClick={() => void copyText(text).then((ok) => setState(ok ? "copied" : "failed"))}
        label={
          state === "copied" ? "コピーしました" : state === "failed" ? "コピーできません" : "コピー"
        }
      />
      {/* The label change is the confirmation for anyone looking at it; this is
          the same confirmation for anyone who is not. */}
      <span
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        {state === "copied" ? "コピーしました" : state === "failed" ? "コピーできませんでした" : ""}
      </span>
    </>
  );
}
