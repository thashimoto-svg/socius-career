"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDoc } from "firebase/firestore";
import { defaultTheme, titleFromFirstMessage } from "@socius/prompts";
import { Bubble } from "@/components/Bubble";
import { AuthSplash } from "@/components/auth-splash";
import { useAuth } from "@/lib/firebase/auth-context";
import { createEpisode } from "@/lib/firebase/episodes";
import {
  sessionRef,
  toSession,
  type ChatMode,
  type Message,
  type Session,
  type Star,
} from "@/lib/firebase/schema";
import {
  appendMessage,
  closeSession,
  getOrCreateOpenSession,
  getSessionMessages,
  reopenSession,
  updateSessionMeta,
} from "@/lib/firebase/sessions";
import { postJson, postStream } from "@/lib/api-client";
import { T } from "@/lib/theme";

const MODES: { id: ChatMode; label: string }[] = [
  { id: "counselor", label: "じっくり(カウンセラー風)" },
  { id: "karakuchi", label: "ストレート(辛口)" },
];

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
  const [mode, setMode] = useState<ChatMode>("counselor");
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  // The reply as it streams in, before it exists as a saved message.
  const [streaming, setStreaming] = useState("");
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profile = userDoc?.profile ?? null;
  const accent = mode === "karakuchi" ? T.karakuchi : T.primary;
  const resumeId = searchParams.get("s");

  const bottomRef = useRef<HTMLDivElement>(null);
  // Loading a session twice would double the opening message, and React runs
  // effects twice in development.
  const loadedFor = useRef<string | null>(null);

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

  // Open the session: resume the one the history screen pointed at, otherwise
  // pick up the most recent unfinished 壁打ち, otherwise start a new one.
  useEffect(() => {
    if (!user) return;

    const key = `${user.uid}:${resumeId ?? "latest"}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;

    let cancelled = false;

    (async () => {
      try {
        const theme = defaultTheme(profile);
        const opened =
          // A link to a session that no longer exists falls through to the
          // normal path rather than stranding the student on a blank screen.
          (resumeId ? await resumeById(user.uid, resumeId) : null) ??
          (await getOrCreateOpenSession(user.uid, {
            title: "新しい壁打ち",
            theme,
            mode: "counselor",
          }));

        if (cancelled) return;

        const history = await getSessionMessages(user.uid, opened.id);
        if (cancelled) return;

        setSession(opened);
        setMode(opened.mode);
        setMessages(history);

        // A session with no transcript yet is one the AI has to open.
        if (history.length === 0) {
          await requestReply(opened.id, [], opened.mode, opened.theme || theme);
        }
      } catch {
        if (!cancelled) {
          setError("壁打ちを開けませんでした。ページを再読み込みしてください。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, resumeId, profile, requestReply]);

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

    await requestReply(session.id, next, mode, session.theme);
  };

  const changeMode = (next: ChatMode) => {
    setMode(next);
    if (user && session) void updateSessionMeta(user.uid, session.id, { mode: next });
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
    return error ? (
      <div
        style={{
          padding: 24,
          fontSize: 12.5,
          color: T.karakuchi,
          lineHeight: 1.9,
        }}
      >
        {error}
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
      {/* theme + tone switch */}
      <div
        style={{
          padding: "12px 16px 10px",
          borderBottom: `1px solid ${T.line}`,
          background: T.paper,
        }}
      >
        <div style={{ fontSize: 11, color: T.sub, marginBottom: 6 }}>
          今日のテーマ: {session.theme || defaultTheme(profile)}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {MODES.map((m) => {
            const active = mode === m.id;
            const c = m.id === "karakuchi" ? T.karakuchi : T.primary;
            const soft = m.id === "karakuchi" ? T.karakuchiSoft : T.primarySoft;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => changeMode(m.id)}
                aria-pressed={active}
                style={{
                  flex: 1,
                  padding: "7px 0",
                  borderRadius: 9,
                  fontSize: 11.5,
                  fontWeight: 700,
                  border: `1.5px solid ${active ? c : T.line}`,
                  background: active ? soft : T.paper,
                  color: active ? c : T.sub,
                  cursor: "pointer",
                }}
              >
                {m.label}
              </button>
            );
          })}
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
            トーンが変わっても、深掘りの段数は変わりません(全モード共通)
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

/**
 * Resume the session the 履歴 screen linked to. A finished session reopens
 * rather than starting a new one — the student came back to this conversation
 * on purpose.
 */
async function resumeById(uid: string, sessionId: string): Promise<Session | null> {
  const snap = await getDoc(sessionRef(uid, sessionId));
  if (!snap.exists()) return null;

  const session = toSession(snap.id, snap.data());
  if (session.status === "closed") {
    await reopenSession(uid, sessionId);
    return { ...session, status: "open" };
  }
  return session;
}
