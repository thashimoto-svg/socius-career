"use client";

import { useEffect } from "react";

/**
 * Publishes the height the app can actually use, as `--sc-app-height`.
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
 */
export function ViewportHeight() {
  useEffect(() => {
    const visual = window.visualViewport;

    const apply = () => {
      const height = visual?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--sc-app-height", `${height}px`);
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
