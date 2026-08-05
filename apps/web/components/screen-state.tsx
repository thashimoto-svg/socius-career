"use client";

import { fs, T } from "@/lib/theme";

/**
 * What a screen shows instead of its data.
 *
 * Shared so that "it did not load" looks and behaves the same everywhere. Each
 * screen used to phrase its own failure — 「エピソードを読み込めませんでした」,
 * 「記録を読み込めませんでした」 — and every one of them ended in
 * 「ページを再読み込みしてください」, which asks the student to fix it with the
 * browser because the app had not been given a button. Now it has one.
 */

/** The wait. Deliberately quiet; it is usually over before it is read. */
export function ScreenLoading() {
  return <div style={{ fontSize: fs(12), color: T.sub }}>読み込んでいます…</div>;
}

export function ScreenError({
  message,
  onRetry,
  fill = false,
}: {
  message: string;
  onRetry: () => void;
  /**
   * True when there is nothing else on the screen — the 壁打ち with no
   * conversation to show. The failure takes the whole panel and sits in the
   * middle of it rather than pretending to be a note above content.
   */
  fill?: boolean;
}) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: fill ? "center" : "flex-start",
        justifyContent: fill ? "center" : "flex-start",
        gap: 12,
        textAlign: fill ? "center" : "left",
        ...(fill
          ? { flex: 1, padding: 24 }
          : { marginBottom: 16 }),
      }}
    >
      <div style={{ fontSize: fs(12.5), color: T.karakuchi, lineHeight: 1.9 }}>
        {message}
        <br />
        通信状況を確認して、もう一度お試しください。
      </div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          padding: "9px 24px",
          borderRadius: 10,
          border: `1.5px solid ${T.primary}`,
          background: T.primarySoft,
          color: T.primary,
          fontSize: fs(12),
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        再試行
      </button>
    </div>
  );
}
