"use client";

import { useEffect } from "react";

/**
 * Publishes where the app can actually be seen: `--sc-app-height` for how tall
 * that area is, and `--sc-viewport-offset` for how far down the screen it
 * starts.
 *
 * `100dvh` accounts for the browser's own collapsing toolbars but not for the
 * on-screen keyboard: on iOS Safari the layout viewport keeps its full height
 * when the keyboard opens, and the bottom of the page — the composer and the
 * tabs — simply ends up underneath it. That is the 「入力欄が画面外に消える」
 * report, and no amount of `dvh` fixes it, because the unit is not wrong about
 * the viewport, it is measuring a different viewport.
 *
 * The visual viewport is the one that shrinks. Reading it into a custom
 * property lets the shell size itself against the space that is actually
 * visible, keyboard or no keyboard. `100dvh` stays as the fallback for the
 * first paint and for anything without the API.
 *
 * ── Why the offset as well as the height (β報告 8/12) ──
 * Shrinking was not enough on its own. iOS does not only shrink the visible
 * area, it *pans* it: the keyboard slides the visual viewport down inside a
 * layout viewport that is still full height, and everything anchored to the
 * top of the page — which is the whole app frame — stays up where the page
 * begins rather than where the student is looking. What that produced on a
 * real phone was the tab bar floating across the middle of the screen with the
 * お知らせ card sitting on top of the composer: not two elements overlapping,
 * but one frame drawn half off the top of the visible strip.
 *
 * `offsetTop` is exactly how far it was panned, so the shell is pinned to
 * `top: var(--sc-viewport-offset)` and lands back on the visible strip. It is
 * 0 on every desktop browser and on Android, where the layout viewport resizes
 * instead — see `interactiveWidget` in app/layout.tsx — so this costs those
 * nothing.
 */
export function ViewportHeight() {
  useEffect(() => {
    const visual = window.visualViewport;

    const apply = () => {
      const root = document.documentElement;
      const height = visual?.height ?? window.innerHeight;
      root.style.setProperty("--sc-app-height", `${height}px`);
      root.style.setProperty("--sc-viewport-offset", `${visual?.offsetTop ?? 0}px`);
    };

    apply();

    // `scroll` as well as `resize`: on iOS the visual viewport is panned rather
    // than resized when focus moves between fields with the keyboard already
    // up, and only the scroll event fires for that.
    visual?.addEventListener("resize", apply);
    visual?.addEventListener("scroll", apply);
    window.addEventListener("orientationchange", apply);

    return () => {
      visual?.removeEventListener("resize", apply);
      visual?.removeEventListener("scroll", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  return null;
}
