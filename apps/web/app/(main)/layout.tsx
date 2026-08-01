"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExtractionProvider } from "@/components/extraction-provider";
import { RequireAuth } from "@/components/require-auth";
import { fs, T } from "@/lib/theme";

/**
 * 履歴 is not here (MTG 7/30).
 *
 * A list of past conversations answers exactly one question — "which one was
 * that" — and a question you ask occasionally does not need a permanent third
 * of the bottom bar. It is the ☰ drawer now, reachable from every screen. The
 * slot went to ホーム, which answers the question nothing was answering: whether
 * any of this is adding up to anything.
 */
const NAV = [
  // /history is still a screen — it is what the 直近の壁打ち card opens, and it
  // shows the 自分史 badges the drawer has no room for. It just is not a tab
  // any more, so it counts as part of ホーム for the purpose of which one
  // lights up.
  { href: "/home", label: "ホーム", also: ["/history"] },
  { href: "/chat", label: "壁打ち", also: [] },
  { href: "/jibunshi", label: "自分史", also: [] },
] as const;

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <RequireAuth>
      {/* Above the pages: extraction is triggered by leaving a 壁打ち, so the
          thing that runs it must outlive the screen that asks for it. */}
      <ExtractionProvider>
        {/*
          Pinned to exactly the visible height rather than allowed to grow.
          Everything that has to stay on screen — the tab bar, and the composer
          the chat screen puts above it — is a sibling of the one panel that
          scrolls, so nothing can push them past the bottom edge. When the
          keyboard opens, --sc-app-height shrinks and the whole shell shrinks
          with it instead of sliding underneath.
        */}
        <div
          className="flex flex-col"
          style={{ height: "var(--sc-app-height, 100dvh)", minHeight: 0 }}
        >
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>

          <nav
            style={{
              flexShrink: 0,
              display: "flex",
              borderTop: `1px solid ${T.line}`,
              background: T.paper,
              // Keeps the labels clear of the home indicator rather than
              // letting the OS draw its bar on top of them.
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
            }}
          >
            {NAV.map((n) => {
              const active = [n.href, ...n.also].some(
                (href) => pathname === href || pathname.startsWith(`${href}/`),
              );
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  style={{
                    flex: 1,
                    padding: "11px 0 13px",
                    textAlign: "center",
                    fontSize: fs(11.5),
                    fontWeight: 700,
                    color: active ? T.primary : T.sub,
                    borderTop: `2.5px solid ${active ? T.primary : "transparent"}`,
                  }}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </ExtractionProvider>
    </RequireAuth>
  );
}
