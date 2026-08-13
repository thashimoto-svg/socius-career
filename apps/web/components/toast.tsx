"use client";

import { fs, T } from "@/lib/theme";

/**
 * The strip that appears at the bottom of the screen to say something finished.
 *
 * Two things raise one now — extraction saying a card was written, and the
 * delete flow saying a 壁打ち is gone — and they must not drift apart in
 * position or shape, because the student sees them in the same corner of the
 * same screen minutes apart. So the drawing lives here and the deciding stays
 * with whoever raised it.
 *
 * Announced rather than only shown: it appears while the student is usually
 * looking at whatever they navigated to, not at the bottom of the window.
 */

export type ToastTone = "ok" | "warn" | "info";

/** How long a toast stays before it goes away on its own. */
export const TOAST_MS = 4200;

const TONES: Record<ToastTone, { background: string; border: string; color: string }> = {
  // 自分史に残った — the gold is the 「自分の言葉=資産」 colour, and it is
  // deliberately not used for anything that removes something.
  ok: { background: T.goldSoft, border: T.gold, color: T.goldInk },
  warn: { background: T.karakuchiSoft, border: T.karakuchi, color: T.karakuchi },
  // A plain acknowledgement. Deleting a 壁打ち is neither an achievement nor a
  // warning, and dressing it as either would tell the student something about
  // their own decision that the app has no business having an opinion on.
  info: { background: T.paper, border: T.line, color: T.ink },
};

export function Toast({ tone, children }: { tone: ToastTone; children: React.ReactNode }) {
  const palette = TONES[tone];
  return (
    <div
      role="status"
      aria-live="polite"
      className="sc-fade"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 66px)",
        zIndex: 60,
        maxWidth: "min(432px, calc(100% - 32px))",
        padding: "10px 16px",
        borderRadius: 12,
        background: palette.background,
        border: `1.5px solid ${palette.border}`,
        color: palette.color,
        fontSize: fs(11.5),
        fontWeight: 700,
        lineHeight: 1.7,
        boxShadow: `0 6px 20px ${T.shadow}`,
      }}
    >
      {children}
    </div>
  );
}
