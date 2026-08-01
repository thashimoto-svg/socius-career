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
        <div className="flex min-h-0 flex-1 flex-col">
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>

          <nav
            style={{ display: "flex", borderTop: `1px solid ${T.line}`, background: T.paper }}
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
