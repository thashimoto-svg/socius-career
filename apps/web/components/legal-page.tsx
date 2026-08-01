import Link from "next/link";
import { fs, T } from "@/lib/theme";

/**
 * Shared shell for /privacy and /terms.
 *
 * Both are reachable from the login screen, so neither can sit behind
 * RequireAuth: a student has to be able to read what they are agreeing to
 * before they agree to it.
 */
export function LegalPage({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div style={{ padding: "26px 22px", flex: 1, display: "flex", flexDirection: "column" }}>
      <h1 className="sc-display" style={{ fontSize: fs(20), fontWeight: 700, marginBottom: 16 }}>
        {title}
      </h1>

      <div style={{ fontSize: fs(13), color: T.ink, lineHeight: 2 }}>{children}</div>

      <div style={{ marginTop: "auto", paddingTop: 28 }}>
        <Link href="/login" style={{ fontSize: fs(12.5), color: T.primary, fontWeight: 700 }}>
          ← ログイン画面にもどる
        </Link>
      </div>
    </div>
  );
}

/** The placeholder body both pages carry until the real text is written. */
export function ComingSoon() {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 12,
        background: T.goldSoft,
        color: T.goldInk,
        fontSize: fs(12.5),
        lineHeight: 1.95,
      }}
    >
      正式版は近日公開します。
    </div>
  );
}
