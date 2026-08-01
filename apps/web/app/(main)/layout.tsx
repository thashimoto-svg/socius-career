"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExtractionProvider } from "@/components/extraction-provider";
import { RequireAuth } from "@/components/require-auth";
import { T } from "@/lib/theme";

const NAV = [
  { href: "/chat", label: "壁打ち" },
  { href: "/history", label: "履歴" },
  { href: "/jibunshi", label: "自分史" },
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
              const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  style={{
                    flex: 1,
                    padding: "11px 0 13px",
                    textAlign: "center",
                    fontSize: 11.5,
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
