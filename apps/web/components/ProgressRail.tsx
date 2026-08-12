"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PROGRESS_STEPS,
  progressComplete,
  type ProgressStep,
} from "@socius/prompts";
import { fs, T } from "@/lib/theme";

/**
 * 状況 → 課題 → 行動 → 結果 → 学び、常に見えているところに。
 *
 * βフィードバック: 「壁打ちの終わりが見えず途中離脱されやすい」。問いに答えると
 * 次の問いが来る画面には、進んでいる感覚も、あと何回で終わるのかという情報も
 * ない。壁打ちには完成条件があるのに、それを知っているのはプロンプトだけだった。
 *
 * 出すのは残り時間でも往復数でもなく、揃うべき5つ。ガクチカが1本になる条件は
 * 実際にそれで、「あと2つ」は「あと3往復」より正確で、しかも学生が自分で
 * 埋めにいける形をしている。
 *
 * 高さは意図的にぎりぎりまで削ってある。会話の上に常駐するものなので、
 * バー3pxとラベル1行より大きくなった時点で、これは進捗ではなく邪魔になる。
 */

/** Set once the student has seen the one-line explanation. */
const HINT_KEY = "sc.progress.hintSeen";

type ProgressRailProps = {
  steps: ProgressStep[];
  /** The tone's colour, so the rail belongs to the conversation it is above. */
  accent: string;
};

export function ProgressRail({ steps, accent }: ProgressRailProps) {
  const done = progressComplete(steps);

  // null until the browser has been asked. Rendering the hint on the server and
  // then removing it is a line of text that appears and vanishes on every cold
  // load, which reads as a bug in a screen that is otherwise still.
  const [hintSeen, setHintSeen] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setHintSeen(window.localStorage.getItem(HINT_KEY) === "1");
    } catch {
      // Private mode, or storage turned off. Showing the hint is the safe side
      // of this: a student who sees the explanation twice has lost nothing.
      setHintSeen(false);
    }
  }, []);

  const dismissHint = useCallback(() => {
    setHintSeen(true);
    try {
      window.localStorage.setItem(HINT_KEY, "1");
    } catch {
      // Nothing to do. It comes back next time, which is not worth handling.
    }
  }, []);

  // Once anything is filled the rail explains itself, so the sentence has done
  // its job whether or not it was read — and it should not come back at the top
  // of the next 壁打ち.
  useEffect(() => {
    if (hintSeen === false && steps.length > 0) dismissHint();
  }, [hintSeen, steps.length, dismissHint]);

  const showHint = hintSeen === false && steps.length === 0 && !done;

  return (
    <div
      style={{
        flexShrink: 0,
        padding: "8px 14px 9px",
        borderBottom: `1px solid ${T.line}`,
        background: T.paper,
      }}
    >
      <div className="sc-readable">
        <ol
          aria-label="ガクチカの進捗"
          style={{
            display: "flex",
            gap: 6,
            margin: 0,
            padding: 0,
            listStyle: "none",
          }}
        >
          {PROGRESS_STEPS.map((step) => {
            const filled = steps.includes(step.id);
            return (
              <li
                key={step.id}
                // The bar is the whole visual; a screen reader gets the same
                // information as a word instead.
                aria-label={`${step.label}: ${filled ? "済" : "まだ"}`}
                style={{ flex: 1, minWidth: 0 }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    height: 3,
                    borderRadius: 999,
                    // 揃った瞬間だけ金茶に変わる。自分史のカードと同じ色で、
                    // 「残るものになった」を色ひとつで言うため。
                    background: filled ? (done ? T.gold : accent) : T.line,
                  }}
                />
                <div
                  aria-hidden="true"
                  style={{
                    marginTop: 4,
                    textAlign: "center",
                    fontSize: fs(9.5),
                    fontWeight: filled ? 700 : 500,
                    color: done ? T.goldInk : filled ? accent : T.sub,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {step.label}
                </div>
              </li>
            );
          })}
        </ol>

        {done && (
          <div
            // Announced, because the student is looking at the bottom of the
            // conversation and this appears at the top of it.
            role="status"
            style={{
              marginTop: 7,
              fontSize: fs(10.5),
              fontWeight: 700,
              color: T.goldInk,
              lineHeight: 1.6,
            }}
          >
            エピソードがそろいました。自分史に追加されます
          </div>
        )}

        {showHint && (
          <div
            style={{
              marginTop: 7,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: fs(10.5),
              color: T.sub,
              lineHeight: 1.6,
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              この5つがそろうと、ガクチカが1本完成します
            </span>
            <button
              type="button"
              onClick={dismissHint}
              aria-label="説明を閉じる"
              style={{
                flexShrink: 0,
                border: "none",
                background: "none",
                padding: "0 2px",
                color: T.sub,
                fontSize: fs(11),
                lineHeight: 1.4,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
