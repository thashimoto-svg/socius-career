"use client";

import { useState } from "react";
import { EPISODES, type Star } from "@/lib/sample-data";
import { T } from "@/lib/theme";

const STAR_LABELS: { key: keyof Star; label: string }[] = [
  { key: "S", label: "状況" },
  { key: "T", label: "課題" },
  { key: "A", label: "行動" },
  { key: "R", label: "結果" },
];

// Every card holds the student's own words, structured as STAR + 学び + 感情 —
// never a loose blob of text, and never rewritten into the AI's voice.
// TODO(supabase): read from the `episodes` table; wire 編集 to an edit route
// and add Markdown export in v0.2.
export default function JibunshiPage() {
  const [openId, setOpenId] = useState<string | null>(EPISODES[0]?.id ?? null);

  return (
    <div style={{ padding: "20px 16px" }}>
      <h1 className="sc-display" style={{ fontSize: 18, fontWeight: 700 }}>
        自分史
      </h1>
      <p style={{ fontSize: 11.5, color: T.sub, margin: "4px 0 14px" }}>
        ここにある言葉は、すべてあなた自身が話したことです。
      </p>

      {EPISODES.map((e) => {
        const isOpen = openId === e.id;
        const bodyId = `episode-${e.id}`;
        return (
          <div
            key={e.id}
            style={{
              background: T.paper,
              border: `1px solid ${isOpen ? T.gold : T.line}`,
              borderLeft: `4px solid ${T.gold}`,
              borderRadius: 14,
              marginBottom: 12,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : e.id)}
              aria-expanded={isOpen}
              aria-controls={bodyId}
              style={{
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                padding: "13px 15px",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: T.primary,
                    background: T.primarySoft,
                    padding: "2px 8px",
                    borderRadius: 999,
                  }}
                >
                  {e.tag}
                </span>
                <span style={{ fontSize: 10, color: T.sub }}>感情: {e.emotion}</span>
              </div>
              <div className="sc-display" style={{ fontSize: 14.5, fontWeight: 700, color: T.ink }}>
                {e.title}
              </div>
            </button>

            {isOpen && (
              <div id={bodyId} className="sc-fade" style={{ padding: "0 15px 13px" }}>
                {STAR_LABELS.map(({ key, label }) => (
                  <div key={key} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                    <div
                      style={{
                        minWidth: 34,
                        height: 22,
                        borderRadius: 6,
                        background: T.bg,
                        color: T.primary,
                        fontSize: 10.5,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {key}・{label}
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>{e.star[key]}</div>
                  </div>
                ))}

                <div
                  style={{
                    background: T.goldSoft,
                    borderRadius: 10,
                    padding: "9px 12px",
                    margin: "10px 0",
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#8a6420", marginBottom: 3 }}>
                    学び ── 自分の言葉で
                  </div>
                  <div className="sc-display" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                    {e.learn}
                  </div>
                </div>

                {/* Ownership: the student can edit, delete, and (v0.2) export. */}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: 9,
                      border: `1.5px solid ${T.line}`,
                      background: T.paper,
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: T.ink,
                      cursor: "pointer",
                    }}
                  >
                    編集する
                  </button>
                  <button
                    type="button"
                    disabled
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: 9,
                      border: `1.5px solid ${T.line}`,
                      background: T.paper,
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: T.sub,
                    }}
                  >
                    書き出す(v0.2)
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
