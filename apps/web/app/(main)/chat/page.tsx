"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { defaultTheme, titleFromFirstMessage } from "@socius/prompts";
import { Bubble } from "@/components/Bubble";
import { AuthSplash } from "@/components/auth-splash";
import { useAuth } from "@/lib/firebase/auth-context";
import { createEpisode } from "@/lib/firebase/episodes";
import {
  type ChatMode,
  type Message,
  type Session,
  type Star,
} from "@/lib/firebase/schema";
import {
  appendMessage,
  closeSession,
  createSession,
  openChat,
  updateSessionMeta,
  type OpenedChat,
} from "@/lib/firebase/sessions";
import { SessionDrawer } from "@/components/SessionDrawer";
import { postJson, postStream } from "@/lib/api-client";
import { T } from "@/lib/theme";

/**
 * The style is chosen once, when the 壁打ち is created, and then shown rather
 * than offered (MTG 7/20). Mid-session switching is gone: the transcript the
 * model is given would then mix two tones, and the cached history would no
 * longer match the instruction that produced it.
 */
const MODE_LABELS: Record<ChatMode, string> = {
  counselor: "じっくりモード",
  karakuchi: "ストレートモード",
};

type ExtractReply = {
  episode: {
    title: string;
    tag: string;
    emotion: string;
    star: Star;
    learn: string;
  };
};

export default function ChatPage() {
  // useSearchParams needs a boundary for the shell to be prerendered.
  return (
    <Suspense fallback={<AuthSplash />}>
      <ChatScreen />
    </Suspense>
  );
}

function ChatScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, userDoc } = useAuth();

  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  // The reply as it streams in, before it exists as a saved message.
  const [streaming, setStreaming] = useState("");
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from `error`: this one means there is no conversation on screen
  // to attach a message to, so it needs the whole screen and a way out.
  const [openError, setOpenError] = useState<string | null>(null);
  const [openAttempt, setOpenAttempt] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);

  const profile = userDoc?.profile ?? null;
  // The session document is the only source of truth for the tone, so there is
  // no local copy that could drift from what is saved.
  const mode: ChatMode = session?.mode ?? "counselor";
  const accent = mode === "karakuchi" ? T.karakuchi : T.primary;
  const resumeId = searchParams.get("s");
  const theme = defaultTheme(profile);

  const bottomRef = useRef<HTMLDivElement>(null);
  // The request to open a session, remembered so that the two runs React makes
  // of the same mount in development share one — the first run is cancelled
  // the instant it starts, so anything the second run declines to redo is work
  // nobody is left listening for.
  const openRequest = useRef<{ key: string; promise: Promise<OpenedChat> } | null>(
    null,
  );

  /** Ask Gemini for the next line and append it to the transcript. */
  const requestReply = useCallback(
    async (sessionId: string, transcript: Message[], tone: ChatMode, theme: string) => {
      if (!user) return;
      setThinking(true);
      setError(null);
      setStreaming("");
      try {
        const text = await postStream(
          "/api/chat",
          user,
          {
            mode: tone,
            theme,
            profile,
            messages: transcript.map((m) => ({ role: m.role, text: m.text })),
          },
          (delta) => setStreaming((prev) => prev + delta),
        );
        // Saved only once the reply is complete: messages are append-only, so a
        // half-written turn would be stuck in the transcript permanently.
        const saved = await appendMessage(user.uid, sessionId, {
          role: "ai",
          text: text.trim(),
          mode: tone,
        });
        setMessages((prev) => [...prev, saved]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "応答に失敗しました。");
      } finally {
        setThinking(false);
        setStreaming("");
      }
    },
    [user, profile],
  );

  // The opening line needs the current tone and profile, but neither may be a
  // dependency of the effect below: a new identity for either would re-open the
  // session and wipe the screen out from under a conversation in progress.
  const requestReplyRef = useRef(requestReply);
  useEffect(() => {
    requestReplyRef.current = requestReply;
  }, [requestReply]);

  // Open the session: resume the one the history screen pointed at, otherwise
  // pick up the most recent unfinished 壁打ち, otherwise start a new one.
  useEffect(() => {
    if (!user) return;

    const uid = user.uid;
    const key = `${uid}:${resumeId ?? "latest"}:${openAttempt}`;

    // Switching threads from the drawer would otherwise leave the previous
    // conversation on screen under the new session's header until its
    // transcript arrived.
    setSession(null);
    setMessages([]);
    setStreaming("");
    setError(null);
    setOpenError(null);

    if (openRequest.current?.key !== key) {
      openRequest.current = {
        key,
        promise: openChat(uid, {
          resumeId,
          fallback: { title: "新しい壁打ち", theme, mode: "counselor" },
        }),
      };
    }

    let cancelled = false;

    openRequest.current.promise.then(
      ({ session: opened, messages: history }) => {
        if (cancelled) return;

        setSession(opened);
        setMessages(history);

        // A session with no transcript yet is one the AI has to open.
        if (history.length === 0) {
          void requestReplyRef.current(
            opened.id,
            [],
            opened.mode,
            opened.theme || theme,
          );
        }
      },
      () => {
        if (cancelled) return;
        setOpenError("壁打ちを読み込めませんでした。");
      },
    );

    return () => {
      cancelled = true;
    };
  }, [user, resumeId, theme, openAttempt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking, streaming]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !user || !session || thinking) return;

    setDraft("");
    const saved = await appendMessage(user.uid, session.id, {
      role: "user",
      text,
      mode: null,
    });
    const next = [...messages, saved];
    setMessages(next);

    // 「新しい壁打ち」 is a placeholder; the student's opening line is a better
    // name for it in the history list.
    if (session.title === "新しい壁打ち") {
      const title = titleFromFirstMessage(text);
      setSession({ ...session, title });
      void updateSessionMeta(user.uid, session.id, { title });
    }

    await requestReply(session.id, next, session.mode, session.theme);
  };

  const openFromDrawer = (sessionId: string) => {
    setDrawerOpen(false);
    if (sessionId === session?.id) return;
    router.push(`/chat?s=${sessionId}`);
  };

  // The one point where the style is decided. It is fixed for the life of the
  // session from here on, so it arrives as an argument rather than being read
  // off whatever conversation happened to be open.
  const startNewSession = async (nextMode: ChatMode) => {
    if (!user || creatingSession) return;
    setCreatingSession(true);
    try {
      // Created before navigating so the drawer's own list has something to
      // show next time it opens, rather than a thread that exists only as a
      // pending URL.
      const created = await createSession(user.uid, {
        title: "新しい壁打ち",
        theme,
        mode: nextMode,
      });
      setDrawerOpen(false);
      router.push(`/chat?s=${created.id}`);
    } catch {
      setError("新しい壁打ちを始められませんでした。もう一度お試しください。");
    } finally {
      setCreatingSession(false);
    }
  };

  const endSession = async () => {
    if (!user || !session || ending) return;
    setEnding(true);
    setError(null);
    try {
      const { episode } = await postJson<ExtractReply>("/api/extract", user, {
        messages: messages.map((m) => ({ role: m.role, text: m.text })),
      });
      await createEpisode(user.uid, { ...episode, sessionId: session.id });
      await closeSession(user.uid, session.id, { addedEpisode: true });
      router.push("/jibunshi");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エピソードを残せませんでした。");
      setEnding(false);
    }
  };

  if (!session) {
    return openError ? (
      <div
        role="alert"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 12.5, color: T.karakuchi, lineHeight: 1.9 }}>
          {openError}
          <br />
          通信状況を確認して、もう一度お試しください。
        </div>
        <button
          type="button"
          onClick={() => setOpenAttempt((n) => n + 1)}
          style={{
            padding: "9px 24px",
            borderRadius: 10,
            border: `1.5px solid ${T.primary}`,
            background: T.primarySoft,
            color: T.primary,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          再試行
        </button>
      </div>
    ) : (
      <AuthSplash />
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      {user && (
        <SessionDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          uid={user.uid}
          currentSessionId={session.id}
          onSelect={openFromDrawer}
          onNewSession={startNewSession}
          creating={creatingSession}
        />
      )}

      {/* theme + the tone this session was started in */}
      <div
        style={{
          padding: "12px 16px 10px",
          borderBottom: `1px solid ${T.line}`,
          background: T.paper,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="壁打ちの一覧を開く"
            aria-expanded={drawerOpen}
            style={{
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
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              color: T.sub,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            今日のテーマ: {session.theme || theme}
          </div>
          {/* Read-only: which tone this 壁打ち was started in. */}
          <div
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontWeight: 700,
              color: accent,
              background: mode === "karakuchi" ? T.karakuchiSoft : T.primarySoft,
              padding: "3px 9px",
              borderRadius: 999,
            }}
          >
            {MODE_LABELS[mode]}
          </div>
        </div>
      </div>

      {/* transcript */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "14px 14px 4px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <span
            style={{
              fontSize: 10.5,
              color: T.sub,
              background: T.bg,
              padding: "4px 10px",
              borderRadius: 999,
            }}
          >
            モードで変わるのは言い方だけ。深掘りの段数はどのモードでも同じです
          </span>
        </div>

        {messages.map((m) => (
          <Bubble key={m.id} who={m.role} mode={m.mode ?? mode}>
            {m.text}
          </Bubble>
        ))}

        {thinking && (
          <Bubble who="ai" mode={mode}>
            {streaming ? (
              <span aria-live="polite">{streaming}</span>
            ) : (
              <span style={{ color: T.sub }}>考えています…</span>
            )}
          </Bubble>
        )}

        {error && (
          <div
            role="alert"
            style={{
              margin: "8px 0",
              padding: "9px 12px",
              borderRadius: 10,
              background: T.karakuchiSoft,
              color: T.karakuchi,
              fontSize: 11.5,
              lineHeight: 1.7,
            }}
          >
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* composer */}
      <div
        style={{
          padding: "10px 12px",
          borderTop: `1px solid ${T.line}`,
          background: T.paper,
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          style={{ display: "flex", gap: 8, alignItems: "center" }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="自分の言葉で書いてみる…"
            aria-label="メッセージ"
            style={{
              flex: 1,
              minWidth: 0,
              padding: "11px 14px",
              borderRadius: 12,
              border: `1.5px solid ${T.line}`,
              fontSize: 12.5,
              color: T.ink,
              background: T.bg,
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={!draft.trim() || thinking}
            aria-label="送信"
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: 12,
              border: "none",
              background: accent,
              color: "#fff",
              fontSize: 15,
              fontWeight: 700,
              opacity: draft.trim() && !thinking ? 1 : 0.45,
              cursor: draft.trim() && !thinking ? "pointer" : "default",
            }}
          >
            ↑
          </button>
        </form>

        <button
          type="button"
          onClick={() => void endSession()}
          disabled={ending || thinking || messages.length < 2}
          style={{
            width: "100%",
            marginTop: 8,
            padding: "9px 0",
            borderRadius: 10,
            border: `1.5px solid ${T.gold}`,
            background: T.goldSoft,
            color: "#8a6420",
            fontSize: 12,
            fontWeight: 700,
            opacity: ending || thinking || messages.length < 2 ? 0.5 : 1,
            cursor: ending ? "default" : "pointer",
          }}
        >
          {ending
            ? "エピソードにまとめています…"
            : "セッションを終えて、エピソードとして残す"}
        </button>
      </div>
    </div>
  );
}
