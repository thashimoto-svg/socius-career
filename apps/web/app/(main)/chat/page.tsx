"use client";

import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { defaultTheme, titleFromFirstMessage } from "@socius/prompts";
import { AdSlot } from "@/components/AdSlot";
import { AppHeader } from "@/components/AppHeader";
import { Bubble } from "@/components/Bubble";
import { AuthSplash } from "@/components/auth-splash";
import { useExtraction } from "@/components/extraction-provider";
import { useBeforeLeave } from "@/components/leave-guard";
import { ScreenError } from "@/components/screen-state";
import { useAuth } from "@/lib/firebase/auth-context";
import { AD_INTERVAL, adSlotFollows } from "@/lib/ads";
import { hasNewMaterial, MIN_NEW_ON_LEAVE, MIN_NEW_ON_RESUME } from "@/lib/extraction";
import { type ChatMode, type Message, type Session } from "@/lib/firebase/schema";
import { openChat, appendMessage, updateSessionMeta } from "@/lib/firebase/sessions";
import { ToneMenu } from "@/components/ToneMenu";
import { startChat } from "@/lib/new-chat";
import { useLoadable } from "@/lib/use-loadable";
import { ApiError, postStream } from "@/lib/api-client";
import { fs, T } from "@/lib/theme";

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
  const startExtraction = useExtraction();

  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  // The reply as it streams in, before it exists as a saved message.
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The turn that failed, kept so it can be asked for again.
  //
  // The student's message is already saved by the time the reply is requested —
  // the transcript is append-only, so it has to be. Without this, a failed reply
  // left the conversation with a question nobody answered and no button that
  // would make it try again: typing the message a second time only added a
  // second student turn. This is the way out.
  const [failedTurn, setFailedTurn] = useState<{
    sessionId: string;
    transcript: Message[];
    tone: ChatMode;
    theme: string;
  } | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);

  const profile = userDoc?.profile ?? null;
  // The session document is the only source of truth for the tone, so there is
  // no local copy that could drift from what is saved.
  const mode: ChatMode = session?.mode ?? "counselor";
  const accent = mode === "karakuchi" ? T.karakuchi : T.primary;
  const resumeId = searchParams.get("s");
  const theme = defaultTheme(profile);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Which conversation to show: the one a link pointed at, otherwise the most
  // recent unfinished 壁打ち, otherwise a new one. Loaded the same way every
  // other screen loads its data — including the deadline, which is what stops
  // an unreachable backend from leaving 「読み込んでいます…」 on screen forever.
  const opened = useLoadable(
    user?.uid ?? null,
    (uid) =>
      openChat(uid, {
        resumeId,
        fallback: { title: "新しい壁打ち", theme, mode: "counselor" },
      }),
    {
      message: "壁打ちを読み込めませんでした。",
      scope: resumeId ?? "latest",
    },
  );

  /** Ask Gemini for the next line and append it to the transcript. */
  const requestReply = useCallback(
    async (sessionId: string, transcript: Message[], tone: ChatMode, theme: string) => {
      if (!user) return;
      setThinking(true);
      setError(null);
      setFailedTurn(null);
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
        // 再送 only where sending it again could work. The daily cap will fail
        // the same way until the date changes, and a button that promises
        // otherwise is worse than no button.
        if (!(e instanceof ApiError) || e.retryable) {
          setFailedTurn({ sessionId, transcript, tone, theme });
        }
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
  const themeRef = useRef(theme);
  useEffect(() => {
    requestReplyRef.current = requestReply;
    themeRef.current = theme;
  }, [requestReply, theme]);

  // A 壁打ち with nothing in it is one the AI has to open, and it must be asked
  // exactly once. React mounts every component twice in development, and a
  // retry re-runs the load — neither is a second empty conversation.
  const primed = useRef(new Set<string>());

  // Put what was loaded on screen. Held in state rather than read straight off
  // the loader because the conversation grows from here: every message the
  // student sends is appended to this copy — which is also why what was loaded
  // is the only dependency. Anything else in here re-running would replace a
  // conversation in progress with the transcript it started from.
  useEffect(() => {
    const loaded = opened.data;

    // Switching threads from the drawer would otherwise leave the previous
    // conversation on screen under the new session's header until its
    // transcript arrived.
    setSession(loaded?.session ?? null);
    setMessages(loaded?.messages ?? []);
    setStreaming("");
    setError(null);

    if (!loaded || loaded.messages.length > 0) return;
    if (primed.current.has(loaded.session.id)) return;

    primed.current.add(loaded.session.id);
    void requestReplyRef.current(
      loaded.session.id,
      [],
      loaded.session.mode,
      loaded.session.theme || themeRef.current,
    );
  }, [opened.data]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking, streaming]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !user || !session || thinking) return;

    setDraft("");

    let saved: Message;
    try {
      saved = await appendMessage(user.uid, session.id, {
        role: "user",
        text,
        mode: null,
      });
    } catch {
      // The message was never written, so there is nothing to resend — the
      // student's words go back in the box they came from instead of vanishing.
      setDraft(text);
      setError("メッセージを送れませんでした。通信状況を確認して、もう一度送信してください。");
      return;
    }

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

  // What automatic extraction reads, kept in a ref so the visibility listener
  // below can stay registered once instead of being torn down and rebuilt on
  // every message.
  const current = useRef<{ session: Session | null; messages: Message[] }>({
    session: null,
    messages: [],
  });
  useEffect(() => {
    current.current = { session, messages };
  }, [session, messages]);

  /**
   * Hand the 壁打ち being left over to the background extractor.
   *
   * Fire-and-forget by design: the student is on their way somewhere, and the
   * thing that does the work lives in the layout, so it outlives this screen.
   */
  const handOff = useCallback(
    (minNew: number) => {
      const { session: leaving, messages: transcript } = current.current;
      if (!leaving || !hasNewMaterial(leaving, transcript, minNew)) return;

      startExtraction({
        session: leaving,
        messages: transcript,
        onRead: (extractedCount) =>
          // Only if this screen is still showing the same 壁打ち — by the time
          // this lands, the student is usually looking at a different one.
          setSession((prev) =>
            prev && prev.id === leaving.id ? { ...prev, extractedCount } : prev,
          ),
      });
    },
    [startExtraction],
  );

  /**
   * The same handoff, for whoever navigates away from outside this screen.
   *
   * AppHeader's ＋ and its drawer get it as a prop, because they are rendered
   * from here. The desktop sidebar is not — it lives in the layout, and without
   * this, switching 壁打ち from it would leave the conversation behind with
   * nothing ever extracted from it.
   */
  const handOffOnLeave = useCallback(() => handOff(MIN_NEW_ON_LEAVE), [handOff]);
  useBeforeLeave(handOffOnLeave);

  // 「最後の抽出から6メッセージ以上増えた状態でアプリ復帰時」. Backgrounding the app
  // is the other way a 壁打ち ends — students close the tab mid-thought far more
  // often than they tidily switch threads.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") handOff(MIN_NEW_ON_RESUME);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [handOff]);

  /**
   * Switch tone, which means starting a fresh 壁打ち.
   *
   * The tone is fixed for the life of a session — the transcript sent back to
   * the model would otherwise mix two tones, and the history would no longer
   * match the instruction that produced it. ＋ in the header covers "another
   * one of these"; this covers "one of the other kind".
   */
  const switchTone = async (nextMode: ChatMode) => {
    if (!user || creatingSession) return;
    setCreatingSession(true);
    handOff(MIN_NEW_ON_LEAVE);
    try {
      const id = await startChat(user.uid, { mode: nextMode, profile });
      router.push(`/chat?s=${id}`);
    } catch {
      setError("新しい壁打ちを始められませんでした。もう一度お試しください。");
      setCreatingSession(false);
    }
  };

  if (!session) {
    return opened.error ? (
      // The header comes too, so a 壁打ち that will not load is not also a
      // screen with no way off it.
      <>
        <AppHeader title="壁打ち" />
        <ScreenError message={opened.error} onRetry={opened.retry} fill />
      </>
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
      {/*
        「今日のテーマ」 used to have this bar to itself and is gone (MTG 7/30):
        it was the app announcing what the conversation was about to a student
        who was in the middle of having it. The theme still shapes the system
        prompt — it just no longer takes the widest strip of the screen to say
        something nobody was reading.
      */}
      <AppHeader
        title={session.title}
        currentSessionId={session.id}
        newChatMode={mode}
        onBeforeLeave={() => handOff(MIN_NEW_ON_LEAVE)}
        extra={
          <ToneMenu
            mode={mode}
            busy={creatingSession}
            onSwitch={(next) => void switchTone(next)}
          />
        }
      />

      {/* transcript */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "14px 14px 4px",
        }}
      >
        {/* The scroller is the full width of the column so the scrollbar stays
            at the window's edge; only what is read is narrowed. */}
        <div className="sc-readable">
        {/*
          「モードで変わるのは言い方だけ…」 used to sit here. It was an explanation
          of an implementation decision, printed above every conversation
          forever, and it is gone (MTG 7/30). If the two tones need a note to
          tell them apart, the note is not the thing to fix.
        */}
        {messages.map((m, i) => (
          // Fragment rather than a wrapper, so the bubbles stay siblings and
          // nothing about the transcript's layout depends on whether a slot
          // happens to fall here.
          <Fragment key={m.id}>
            <Bubble who={m.role} mode={m.mode ?? mode}>
              {m.text}
            </Bubble>
            {/* Every AD_INTERVAL messages, and never under the last one —
                see adSlotFollows. The index keeps successive slots from
                being the same card three times down one conversation. */}
            {adSlotFollows(i, messages.length) && (
              <AdSlot index={Math.floor(i / AD_INTERVAL)} />
            )}
          </Fragment>
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
              fontSize: fs(11.5),
              lineHeight: 1.7,
            }}
          >
            {error}
            {failedTurn && (
              <button
                type="button"
                onClick={() =>
                  void requestReply(
                    failedTurn.sessionId,
                    failedTurn.transcript,
                    failedTurn.tone,
                    failedTurn.theme,
                  )
                }
                disabled={thinking}
                style={{
                  display: "block",
                  marginTop: 8,
                  padding: "6px 18px",
                  borderRadius: 9,
                  border: `1.5px solid ${T.karakuchi}`,
                  background: T.paper,
                  color: T.karakuchi,
                  fontSize: fs(11.5),
                  fontWeight: 700,
                  opacity: thinking ? 0.5 : 1,
                  cursor: thinking ? "default" : "pointer",
                }}
              >
                再送する
              </button>
            )}
          </div>
        )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* composer */}
      <div
        style={{
          padding: "10px 12px",
          borderTop: `1px solid ${T.line}`,
          background: T.paper,
        }}
      >
        {/* Same column as the transcript, so the box lines up under the words
            it is for rather than under the whole window. */}
        <form
          className="sc-readable"
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
              fontSize: fs(12.5),
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
              color: T.onAccent,
              fontSize: fs(15),
              fontWeight: 700,
              opacity: draft.trim() && !thinking ? 1 : 0.45,
              cursor: draft.trim() && !thinking ? "pointer" : "default",
            }}
          >
            ↑
          </button>
        </form>
      </div>
    </div>
  );
}
