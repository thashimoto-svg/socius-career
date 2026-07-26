import Link from "next/link";
import { SESSIONS } from "@/lib/sample-data";
import { T } from "@/lib/theme";

// Sessions are saved automatically; tapping one resumes it, so a conversation
// is never consumed in a single sitting.
// TODO(firebase): read from the `sessions` collection and link to /chat/[id].
export default function HistoryPage() {
  return (
    <div style={{ padding: "20px 16px" }}>
      <h1 className="sc-display" style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>
        壁打ちの記録
      </h1>

      {SESSIONS.map((s) => (
        <Link
          key={s.id}
          href="/chat"
          className="sc-fade"
          style={{
            display: "block",
            background: T.paper,
            border: `1px solid ${T.line}`,
            borderRadius: 14,
            padding: "13px 15px",
            marginBottom: 10,
            color: T.ink,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{s.title}</div>
            <div style={{ fontSize: 11, color: T.sub }}>{s.date}</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 7, alignItems: "center" }}>
            <span style={{ fontSize: 10.5, color: T.sub }}>{s.turns}往復</span>
            {s.episodes > 0 ? (
              <span
                style={{
                  fontSize: 10.5,
                  color: "#8a6420",
                  background: T.goldSoft,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontWeight: 700,
                }}
              >
                自分史に{s.episodes}件
              </span>
            ) : (
              <span
                style={{
                  fontSize: 10.5,
                  color: T.primary,
                  background: T.primarySoft,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontWeight: 700,
                }}
              >
                途中から再開できます
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
