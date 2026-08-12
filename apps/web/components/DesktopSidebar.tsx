"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ScreenError, ScreenLoading } from "@/components/screen-state";
import { useLeaveGuard } from "@/components/leave-guard";
import { useAuth } from "@/lib/firebase/auth-context";
import { formatShortDate, type Session } from "@/lib/firebase/schema";
import { listSessions } from "@/lib/firebase/sessions";
import { startChat } from "@/lib/new-chat";
import { useLoadable } from "@/lib/use-loadable";
import { fs, T } from "@/lib/theme";

/**
 * The permanent left column, from 768px up.
 *
 * On a phone the same three things are spread across three controls that each
 * hide the others: the tab bar at the bottom, ☰ for the list of past 壁打ち, and
 * ＋ in the header. That arrangement is a consequence of the width — there is
 * no room to show a list and a conversation at once, so the list is a drawer
 * that covers the conversation.
 *
 * On a desktop there is room, and the drawer stops being a solution and starts
 * being an extra tap in front of something that could simply be on screen. So
 * the sidebar is not a wider drawer: it is what the drawer, the tab bar and ＋
 * become when they no longer have to take turns. Those three hide themselves at
 * this width (see AppHeader and the (main) layout) rather than doubling up.
 */

/** 240–280px. 264 leaves a 壁打ち title about 20 Japanese characters. */
const SIDEBAR_WIDTH = 264;

/** The `md:` breakpoint, as a number, because matchMedia cannot read Tailwind. */
const DESKTOP_QUERY = "(min-width: 768px)";

/**
 * Whether the sidebar is on screen — which is not the same question as whether
 * it is mounted.
 *
 * Hiding it below 768px is CSS's job and has to stay CSS's job: a sidebar that
 * appeared only after JavaScript measured the window would shift the entire
 * page sideways on every desktop load. But `display: none` hides an element
 * without stopping it doing anything, and what this one does is read every
 * 壁打ち the student has, on every navigation. On a phone that is a Firestore
 * query per tap for a list nobody can see.
 *
 * So the layout is decided by the stylesheet and the fetching is decided here.
 * Starting false and correcting after mount is the safe order — it costs the
 * desktop one render before the list starts loading, and it costs the phone
 * nothing at all, which is the way round that matters.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return isDesktop;
}

const NAV = [
  { href: "/home", label: "ホーム", also: ["/history"] },
  { href: "/chat", label: "壁打ち", also: [] },
  { href: "/jibunshi", label: "自分史", also: [] },
  // 設定 is a gear in the corner of the phone header because the bottom bar has
  // exactly three slots and this is not one of the three. Here there is no such
  // scarcity, so it is a nav item like the others (per the PC spec).
  { href: "/settings", label: "設定", also: [] },
] as const;

export function DesktopSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, userDoc } = useAuth();
  const { runBeforeLeave } = useLeaveGuard();
  const isDesktop = useIsDesktop();
  const [creating, setCreating] = useState(false);

  // Which 壁打ち is open, read off the URL rather than passed down — the chat
  // screen is a sibling of this component, not its child, and `?s=` is already
  // the only thing that decides which conversation is on screen.
  const currentSessionId = pathname === "/chat" ? searchParams.get("s") : null;

  /**
   * Reloaded on every navigation, because a permanent list goes stale in a way
   * a drawer never could. The drawer was mounted fresh on each open, which is
   * what kept it honest; this one is mounted for the whole session, and the
   * things it shows — a session's title, its 往復 count, whether it exists at
   * all — change as the student talks.
   *
   * Navigation is the right trigger because it is when the list is wrong:
   * starting a 壁打ち adds a row, and sending the first message renames one.
   */
  const routeKey = `${pathname}?${currentSessionId ?? ""}`;
  const loaded = useLoadable(isDesktop ? (user?.uid ?? null) : null, listSessions, {
    message: "記録を読み込めませんでした。",
    scope: `sidebar:${routeKey}`,
  });

  /**
   * The last list that arrived, kept across reloads.
   *
   * `useLoadable` clears its data when the key changes, which is right for a
   * screen — what was on it belonged to the student's previous question. It is
   * wrong for furniture: the sidebar would blank and re-fill on every single
   * navigation, which is a flicker in the corner of the eye on every click.
   * So the last good answer stays up while the next one is fetched.
   */
  const [shown, setShown] = useState<Session[] | null>(null);
  useEffect(() => {
    if (loaded.data) setShown(loaded.data);
  }, [loaded.data]);

  const newChat = async () => {
    if (!user || creating) return;
    setCreating(true);
    // What AppHeader's ＋ does through its onBeforeLeave prop. This component
    // is above the screens rather than inside one, so it asks the shell.
    runBeforeLeave();
    try {
      const id = await startChat(user.uid, {
        mode: "counselor",
        profile: userDoc?.profile ?? null,
      });
      router.push(`/chat?s=${id}`);
    } finally {
      setCreating(false);
    }
  };

  const openSession = (sessionId: string) => {
    if (sessionId === currentSessionId) return;
    runBeforeLeave();
    router.push(`/chat?s=${sessionId}`);
  };

  return (
    <aside
      aria-label="サイドバー"
      // `display` is the class's, not the style attribute's — an inline
      // display would outrank `hidden` and the sidebar would follow the app
      // onto phones.
      className="hidden md:flex"
      style={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        flexDirection: "column",
        borderRight: `1px solid ${T.line}`,
        background: T.bg,
        height: "100%",
        minHeight: 0,
      }}
    >
      <div
        className="sc-display"
        style={{
          flexShrink: 0,
          padding: "18px 16px 14px",
          fontSize: fs(15),
          fontWeight: 700,
          color: T.ink,
        }}
      >
        Socius Career
      </div>

      <div style={{ flexShrink: 0, padding: "0 12px 12px" }}>
        <button
          type="button"
          onClick={() => void newChat()}
          disabled={creating}
          style={{
            width: "100%",
            padding: "10px 0",
            borderRadius: 11,
            border: `1.5px solid ${T.primary}`,
            background: T.primarySoft,
            color: T.primary,
            fontSize: fs(12.5),
            fontWeight: 700,
            opacity: creating ? 0.6 : 1,
            cursor: creating ? "default" : "pointer",
          }}
        >
          {creating ? "準備しています…" : "＋ 新しい壁打ち"}
        </button>
      </div>

      <nav style={{ flexShrink: 0, padding: "0 8px 10px" }}>
        {NAV.map((n) => {
          const active = [n.href, ...n.also].some(
            (href) => pathname === href || pathname.startsWith(`${href}/`),
          );
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={runBeforeLeave}
              aria-current={active ? "page" : undefined}
              style={{
                display: "block",
                padding: "8px 12px",
                marginBottom: 2,
                borderRadius: 9,
                fontSize: fs(12.5),
                fontWeight: 700,
                color: active ? T.primary : T.sub,
                background: active ? T.primarySoft : "transparent",
              }}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div
        style={{
          flexShrink: 0,
          padding: "10px 16px 6px",
          borderTop: `1px solid ${T.line}`,
          fontSize: fs(10.5),
          fontWeight: 700,
          color: T.sub,
        }}
      >
        壁打ちの記録
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "2px 10px 16px",
        }}
      >
        {/* Only when there is nothing to show instead. A reload behind a list
            that is already up is not something to interrupt the student for. */}
        {loaded.error && shown === null && (
          <ScreenError message={loaded.error} onRetry={loaded.retry} />
        )}

        {loaded.loading && shown === null && <ScreenLoading />}

        {shown?.length === 0 && (
          <div style={{ padding: "6px 6px", fontSize: fs(11), color: T.sub, lineHeight: 1.9 }}>
            まだ記録はありません。
          </div>
        )}

        {shown?.map((s) => {
          const current = s.id === currentSessionId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => openSession(s.id)}
              aria-current={current ? "true" : undefined}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                marginBottom: 4,
                borderRadius: 9,
                border: `1px solid ${current ? T.primary : "transparent"}`,
                background: current ? T.primarySoft : "transparent",
                color: T.ink,
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  fontSize: fs(12),
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.title}
              </div>
              <div style={{ fontSize: fs(10), color: T.sub, marginTop: 3 }}>
                {formatShortDate(s.updatedAt)}・{s.turnCount}往復
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

/**
 * What stands in the sidebar's place while `useSearchParams` suspends.
 *
 * Not a spinner — an empty column of exactly the same width. A static build
 * prerenders these routes without a URL to read, so this is what is in the
 * HTML; anything with content in it would be content that visibly changes
 * shape on hydration, and a column that changes width would take the whole
 * page's layout with it.
 */
export function DesktopSidebarFallback() {
  return (
    <div
      aria-hidden="true"
      className="hidden md:block"
      style={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        borderRight: `1px solid ${T.line}`,
        background: T.bg,
      }}
    />
  );
}
