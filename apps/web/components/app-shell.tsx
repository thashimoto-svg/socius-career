"use client";

import { usePathname } from "next/navigation";

/**
 * The frame everything is drawn inside.
 *
 * It used to be one fixed 480px column for every route, which is the correct
 * answer for a phone and for every screen that is only ever a phone's worth of
 * content — login, onboarding, the legal pages. Those stay in it. A 利用規約
 * set 1400px wide is not a better 利用規約.
 *
 * The signed-in screens do not stay in it, because from 768px up they grow a
 * permanent sidebar beside the content, and a 264px sidebar plus a 720px column
 * does not fit in 480. So the cap is lifted for exactly those routes and the
 * shadow with it — a frame drawn around a full-width app is a line down the
 * middle of nothing.
 *
 * Decided from the path rather than from what is rendered inside it. The
 * obvious alternative, letting the (main) layout mark itself and matching with
 * `:has()`, is a cap that only lifts once the auth gate has opened — so every
 * cold load would paint a 480px splash and then snap the whole page wide the
 * moment the session resolved. The route is known before any of that.
 *
 * ── The same routes are also the ones pinned to the visual viewport ──
 * They are the screens that never scroll the document: exactly one panel
 * inside them scrolls, and the composer and the tabs are pinned around it. A
 * frame like that has to be measured against the strip of screen the student
 * can actually see, and on iOS with the keyboard up that strip is both shorter
 * *and* lower down than the page — so `position: fixed` at the offset
 * components/viewport-height.tsx publishes, rather than the top of a document
 * the keyboard has pushed out from under them.
 *
 * Everything else stays in normal flow, because 利用規約 is longer than a
 * screen and pinning it to one would be a page you cannot read the bottom of.
 */

/** The (main) segment: the screens that get the sidebar. */
const WIDE_ROUTES = ["/home", "/chat", "/jibunshi", "/settings", "/history"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wide = WIDE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  return (
    <div
      className={[
        "mx-auto flex w-full flex-col bg-sc-paper",
        wide
          ? "fixed inset-x-0 max-w-[480px] md:max-w-none md:shadow-none shadow-[0_0_60px_rgba(34,48,47,0.06)]"
          : "max-w-[480px] shadow-[0_0_60px_rgba(34,48,47,0.06)]",
      ].join(" ")}
      style={
        wide
          ? {
              // Not `transform: translateY(…)`, which would do the same job and
              // also turn this into the containing block for every
              // `position: fixed` inside it — the drawer, its scrim, the
              // extraction toast. `top` moves the box without changing what
              // "fixed" means for anything below.
              top: "var(--sc-viewport-offset, 0px)",
              height: "var(--sc-app-height, 100dvh)",
            }
          : { minHeight: "var(--sc-app-height, 100dvh)" }
      }
    >
      {children}
    </div>
  );
}
