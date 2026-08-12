"use client";

/**
 * Where the wait before the first screen actually goes.
 *
 * A measuring instrument, not a feature. Off unless switched on:
 *
 *   localStorage.setItem("sc-perf", "1")   // then reload
 *   localStorage.removeItem("sc-perf")     // done
 *
 * A switch rather than a dev-only build, because the number that matters is the
 * one from the deployed preview on a real phone — a dev build measures
 * Turbopack, and the student is not waiting on Turbopack.
 *
 * Every mark is milliseconds since navigation start, which is what
 * `performance.now()` already counts from. That makes the marks comparable to
 * anything else in the Performance panel without having to line up clocks.
 */

type Mark = { label: string; at: number };

const marks: Mark[] = [];

const enabled =
  typeof window !== "undefined" &&
  (() => {
    try {
      return window.localStorage.getItem("sc-perf") === "1";
    } catch {
      // Storage blocked is exactly one of the conditions worth measuring, so
      // failing to read the switch must not throw on the way to the app.
      return false;
    }
  })();

let dumpTimer: ReturnType<typeof setTimeout> | undefined;

export function mark(label: string): void {
  if (!enabled) return;
  marks.push({ label, at: performance.now() });

  // The sequence has no defined end — a screen may load once or three times —
  // so the report goes out when the marks stop arriving rather than at a point
  // someone had to predict.
  clearTimeout(dumpTimer);
  dumpTimer = setTimeout(dump, 1500);
}

function dump(): void {
  if (marks.length === 0) return;

  const rows = marks.map((m, i) => ({
    区間: m.label,
    "経過(ms)": Math.round(m.at),
    "差分(ms)": i === 0 ? Math.round(m.at) : Math.round(m.at - marks[i - 1].at),
  }));

  console.log(
    `%c[perf] 初回表示までの内訳 — 合計 ${Math.round(marks[marks.length - 1].at)}ms`,
    "font-weight:bold",
  );
  console.table(rows);
  console.log(
    "[perf] コピー用:\n" +
      rows.map((r) => `${r["経過(ms)"]}\t+${r["差分(ms)"]}\t${r.区間}`).join("\n"),
  );
}

if (enabled) {
  mark("script:実行開始");
  // The browser's own numbers for everything before our code ran. Without these
  // the first mark looks like the beginning, when it is already the middle.
  window.addEventListener("load", () => {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (!nav) return;
    console.log(
      `[perf] 参考 — DNS+接続 ${Math.round(nav.connectEnd - nav.startTime)}ms / ` +
        `HTML応答 ${Math.round(nav.responseEnd - nav.requestStart)}ms / ` +
        `DOMContentLoaded ${Math.round(nav.domContentLoadedEventEnd)}ms`,
    );
  });
}
