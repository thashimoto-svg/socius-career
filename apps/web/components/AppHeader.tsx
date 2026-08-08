"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SessionDrawer } from "@/components/SessionDrawer";
import { useAuth } from "@/lib/firebase/auth-context";
import type { ChatMode } from "@/lib/firebase/schema";
import { startChat } from "@/lib/new-chat";
import { fs, T } from "@/lib/theme";

/**
 * The bar every screen has.
 *
 * Two things live here because they have to be reachable from anywhere, not
 * only from inside a conversation (MTG 7/30): ＋ to start a 壁打ち, and ☰ for
 * the list of past ones. 履歴 came off the bottom tabs — it is a drawer, and a
 * drawer that only opens on one screen is a tab in disguise.
 */

type AppHeaderProps = {
  title: string;
  /** Sits between the title and ＋. The tone menu, on the chat screen. */
  extra?: React.ReactNode;
  /** Highlighted in the drawer so the student can see where they are. */
  currentSessionId?: string | null;
  /**
   * Run just before this screen is left for another 壁打ち. The chat screen
   * uses it to hand the conversation being abandoned to the extractor.
   */
  onBeforeLeave?: () => void;
  /**
   * Which tone a 壁打ち started from here should have. On the chat screen that
   * is the tone of the conversation in progress — pressing ＋ is "another one
   * of these", not "start over in some other style".
   */
  newChatMode?: ChatMode;
};

export function AppHeader({
  title,
  extra,
  currentSessionId = null,
  onBeforeLeave,
  newChatMode = "counselor",
}: AppHeaderProps) {
  const router = useRouter();
  const { user, userDoc } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const openSession = (sessionId: string) => {
    setDrawerOpen(false);
    if (sessionId === currentSessionId) return;
    onBeforeLeave?.();
    router.push(`/chat?s=${sessionId}`);
  };

  const newChat = async () => {
    if (!user || creating) return;
    setCreating(true);
    onBeforeLeave?.();
    try {
      const id = await startChat(user.uid, {
        mode: newChatMode,
        profile: userDoc?.profile ?? null,
      });
      setDrawerOpen(false);
      router.push(`/chat?s=${id}`);
    } finally {
      // Left set on the success path too — the screen is about to be replaced,
      // and re-enabling the button first only offers a second tap that would
      // create a second empty 壁打ち.
      setCreating(false);
    }
  };

  return (
    <>
      {/* Mounted only while open, so each open reads the list again rather
          than replaying whatever the last one happened to get. */}
      {user && drawerOpen && (
        <SessionDrawer
          onClose={() => setDrawerOpen(false)}
          uid={user.uid}
          currentSessionId={currentSessionId}
          onSelect={openSession}
          onNewSession={() => void newChat()}
          creating={creating}
        />
      )}

      <header
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          // The notch eats the top of the bar without this, and viewport-fit
          // is cover precisely so it can be measured.
          padding: "calc(env(safe-area-inset-top, 0px) + 10px) 14px 10px",
          borderBottom: `1px solid ${T.line}`,
          background: T.paper,
        }}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="壁打ちの一覧を開く"
          aria-expanded={drawerOpen}
          style={{
            flexShrink: 0,
            border: "none",
            background: "none",
            padding: 2,
            display: "flex",
            alignItems: "center",
            cursor: "pointer",
          }}
        >
          <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true" focusable="false">
            <rect width="16" height="1.6" rx="0.8" fill={T.ink} />
            <rect y="5.2" width="16" height="1.6" rx="0.8" fill={T.ink} />
            <rect y="10.4" width="16" height="1.6" rx="0.8" fill={T.ink} />
          </svg>
        </button>

        <div
          className="sc-display"
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: fs(12.5),
            fontWeight: 700,
            color: T.ink,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>

        {extra}

        <Link
          href="/settings"
          aria-label="設定"
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: T.sub,
          }}
        >
          <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M8.6 1.5h2.8l.35 2.1a6.5 6.5 0 0 1 1.5.87l2-.78 1.4 2.42-1.65 1.34a6.6 6.6 0 0 1 0 1.74l1.65 1.34-1.4 2.42-2-.78c-.46.36-.96.65-1.5.87l-.35 2.1H8.6l-.35-2.1a6.5 6.5 0 0 1-1.5-.87l-2 .78-1.4-2.42 1.65-1.34a6.6 6.6 0 0 1 0-1.74L3.35 6.11l1.4-2.42 2 .78c.46-.36.96-.65 1.5-.87L8.6 1.5Zm1.4 5.6a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8Z"
            />
          </svg>
        </Link>

        <button
          type="button"
          onClick={() => void newChat()}
          disabled={creating}
          aria-label="新しい壁打ちを始める"
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 9,
            border: `1.5px solid ${T.primary}`,
            background: T.primarySoft,
            color: T.primary,
            fontSize: fs(16),
            fontWeight: 700,
            lineHeight: 1,
            opacity: creating ? 0.5 : 1,
            cursor: creating ? "default" : "pointer",
          }}
        >
          ＋
        </button>
      </header>
    </>
  );
}
