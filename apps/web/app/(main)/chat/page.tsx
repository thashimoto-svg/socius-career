"use client";

import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  defaultTheme,
  mergeProgress,
  readProgress,
  stripProgressMarkers,
  titleFromFirstMessage,
} from "@socius/prompts";
import { AdSlot } from "@/components/AdSlot";
import { AppHeader } from "@/components/AppHeader";
import { Bubble } from "@/components/Bubble";
import { ProgressRail } from "@/components/ProgressRail";
import { AuthSplash } from "@/components/auth-splash";
import { useExtraction } from "@/components/extraction-provider";
import { useBeforeLeave } from "@/components/leave-guard";
import { ScreenError } from "@/components/screen-state";
import { useAuth } from "@/lib/firebase/auth-context";
import { AD_INTERVAL, adSlotFollows } from "@/lib/ads";
import { hasNewMaterial, MIN_NEW_ON_LEAVE, MIN_NEW_ON_RESUME } from "@/lib/extraction";
import { type ChatMode, type Message, type Session } from "@/lib/firebase/schema";
import type { ProgressStep } from "@socius/prompts";
import {
  openChat,
  appendMessage,
  getOlderMessages,
  getWholeTranscript,
  saveProgress,
  updateSessionMeta,
} from "@/lib/firebase/sessions";
import { ToneMenu } from "@/components/ToneMenu";
import { startChat } from "@/lib/new-chat";
import { useLoadable } from "@/lib/use-loadable";
import { PHYSICAL_KEYBOARD_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { ApiError, postStream } from "@/lib/api-client";
import { fieldFs, fs, T } from "@/lib/theme";

export default function ChatPage() {
  // useSearchParams needs a boundary for the shell to be prerendered.
  return (
    <Suspense fallback={<AuthSplash />}>
      <ChatScreen />
    </Suspense>
  );
}

/**
 * How many bubbles are on screen when a 壁打ち opens.
 *
 * Reading the transcript is not what made re-opening a long conversation slow;
 * drawing it was. Every bubble carries the `sc-fade` entrance, so a hundred of
 * them meant a hundred simultaneous animations on a phone, under a smooth
 * scroll travelling the whole length of the thread to reach the bottom.
 *
 * A student re-opening a 壁打ち is there to continue it, so the end is what
 * they need drawn. The rest is one tap away and costs nothing until it is
 * asked for.
 */
const VISIBLE_STEP = 40;

/**
 * How tall the composer is allowed to grow before it scrolls instead.
 *
 * The box has to grow, or 「Enterで改行」 gives the student a second line they
 * cannot see. It must not grow without limit either: the keyboard already has
 * most of the screen, and a composer that keeps taking the rest would push the
 * question being answered off the top of it.
 */
const COMPOSER_MAX_HEIGHT = 132;

/**
 * How close to the bottom still counts as being at the bottom.
 *
 * A reply arriving while the student is reading back through the conversation
 * must not yank them to the end of it.
 */
const NEAR_BOTTOM_PX = 120;

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
  /** False when older lines exist above what has been read. */
  const [complete, setComplete] = useState(true);
  /** How many of the loaded lines are folded away above the visible ones. */
  const [hidden, setHidden] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);

  /**
   * On a phone, Enter is 改行 and 送信 is the button — nothing else.
   *
   * 「スマホで改行できない」 (β報告). The box was an `<input>`, which has no
   * second line to break to, inside a `<form>`, where Enter submits. Both
   * halves of that had to go: a `<textarea>` so there is somewhere for the
   * line to go, and no implicit submit so that pressing 改行 does not send.
   *
   * The desktop convention stays, because on a desktop it is the right one:
   * Enter sends, Shift+Enter breaks the line. What decides which is in play is
   * the input device, not the width of the window.
   */
  const enterSends = useMediaQuery(PHYSICAL_KEYBOARD_QUERY);

  const profile = userDoc?.profile ?? null;
  // The session document is the only source of truth for the tone, so there is
  // no local copy that could drift from what is saved.
  const mode: ChatMode = session?.mode ?? "counselor";
  const accent = mode === "karakuchi" ? T.karakuchi : T.primary;
  const resumeId = searchParams.get("s");
  const theme = defaultTheme(profile);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Whether the first paint of this 壁打ち has happened.
   *
   * The jump to the bottom on open has to be instant. Smooth means animating
   * the length of the whole transcript, which on a conversation of any size is
   * seconds of the screen scrolling past on its own before it settles — and
   * what the student sees while it does is the beginning of a thread they
   * opened to continue.
   */
  const settled = useRef(false);

  /**
   * Lines that arrived while this screen was open.
   *
   * The entrance animation belongs to a message appearing, not to a message
   * being present: it is how a new turn announces itself. Playing it for every
   * line of a transcript that was already there is the same animation used to
   * say something it is not true.
   */
  const fresh = useRef(new Set<string>());

  // The 節 the conversation has covered, mirrored out of the session so the
  // reply handler can merge into it. A ref rather than a dependency: taking the
  // session would rebuild requestReply on every turn, and the effect that opens
  // the conversation watches it.
  const progressRef = useRef<ProgressStep[]>([]);

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
        const raw = await postStream(
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

        // The progress markers come off here, before anything is written down.
        // Nothing downstream — the transcript, the 自分史 extraction, the next
        // request's history — ever sees one, so there is exactly one place that
        // has to get the stripping right.
        const { text, steps } = readProgress(raw);
        if (!text) {
          // A reply that was nothing but markers. Retryable, because it is the
          // model having a bad turn rather than anything about this student.
          throw new ApiError(502, "返答を受け取れませんでした。もう一度お試しください。");
        }

        // Saved only once the reply is complete: messages are append-only, so a
        // half-written turn would be stuck in the transcript permanently.
        const saved = await appendMessage(user.uid, sessionId, {
          role: "ai",
          text,
          mode: tone,
        });
        fresh.current.add(saved.id);
        setMessages((prev) => [...prev, saved]);

        const merged = mergeProgress(progressRef.current, steps);
        if (merged.length !== progressRef.current.length) {
          progressRef.current = merged;
          setSession((prev) =>
            prev && prev.id === sessionId ? { ...prev, progress: merged } : prev,
          );
          // Losing this costs the rail its memory the next time the 壁打ち is
          // opened, and nothing else — the conversation is already saved. Not
          // worth an error the student has to read, and not worth failing the
          // turn over, so it is logged.
          void saveProgress(user.uid, sessionId, merged).catch((e) =>
            console.error("[progress] 進捗を保存できませんでした", e),
          );
        }
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
    setComplete(loaded?.complete ?? true);
    setHidden(Math.max(0, (loaded?.messages.length ?? 0) - VISIBLE_STEP));
    setStreaming("");
    setError(null);
    progressRef.current = loaded?.session.progress ?? [];
    // A different conversation is a different first paint: it lands at the
    // bottom without animating, and none of its lines are new.
    settled.current = false;
    fresh.current.clear();

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

  /** Whether the student is reading the end of the conversation right now. */
  const atBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  }, []);

  // Keyed on the last message rather than on the array: loading older lines
  // grows `messages` at the *front*, and following that to the bottom would
  // throw the student back out of the part of the thread they just asked to
  // see.
  const lastId = messages.length > 0 ? messages[messages.length - 1].id : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: settled.current ? "smooth" : "auto" });
    settled.current = true;
  }, [lastId, thinking]);

  // A reply lands a few characters at a time, and 「smooth」 on each of them is
  // a new scroll animation per token — the single most expensive thing this
  // screen does. Instant, and only while the student is actually at the end:
  // scrolling back to re-read something mid-reply must not be undone by the
  // next token.
  useEffect(() => {
    if (!streaming || !atBottom()) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [streaming, atBottom]);

  // The keyboard opening takes about half the transcript away, and what it
  // takes is the bottom half — the last thing the AI asked. The shell resizing
  // does not move the scroller, so without this the student taps the box and
  // the question they were answering scrolls out of sight. Not smooth: the
  // keyboard is already animating, and a second animation on top of it reads
  // as the page lagging.
  useEffect(() => {
    const visual = window.visualViewport;
    if (!visual) return;
    const stayAtBottom = () => {
      if (!document.activeElement?.closest(".sc-composer")) return;
      bottomRef.current?.scrollIntoView({ block: "end" });
    };
    visual.addEventListener("resize", stayAtBottom);
    return () => visual.removeEventListener("resize", stayAtBottom);
  }, []);

  /**
   * Enter, and what it means here.
   *
   * Three things have to be true at once before it sends: the student is on a
   * real keyboard, they are not holding Shift, and — the one that is easy to
   * forget in a Japanese app — the IME is not mid-conversion. Enter is how a
   * candidate is *chosen*, so without the composition check every 漢字 the
   * student picks would send the half-written sentence it was picked in.
   */
  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || !enterSends) return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    void send();
  };

  // The box is one line tall until it is not. Measured rather than counted,
  // because a wrapped line is a line too and the student never pressed 改行 for
  // it.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [draft]);

  /**
   * Show more of the conversation — 「以前のメッセージを読み込む」.
   *
   * One control for two things that look identical from the outside: unfolding
   * lines that were read but not drawn, and fetching the page above them once
   * there are none left. The student is asking to see further back either way,
   * and which side of that line they are on is not their problem.
   */
  const revealOlder = async () => {
    if (hidden > 0) {
      setHidden((n) => Math.max(0, n - VISIBLE_STEP));
      return;
    }
    if (complete || loadingOlder || !user || !session) return;

    const oldest = messages[0]?.createdAt;
    // A message still carrying a pending server timestamp has nothing to
    // cursor on; it is also, by definition, the newest thing here.
    if (!oldest) return;

    setLoadingOlder(true);
    try {
      const page = await getOlderMessages(user.uid, session.id, oldest);
      setMessages((prev) => [...page.messages, ...prev]);
      setComplete(page.complete);
      // The page arrives above what is on screen; one step of it is unfolded
      // and the rest waits, exactly as it does on open.
      setHidden(Math.max(0, page.messages.length - VISIBLE_STEP));
    } catch (e) {
      console.error("[chat] 以前のメッセージを読み込めませんでした", e);
      setError("以前のメッセージを読み込めませんでした。もう一度お試しください。");
    } finally {
      setLoadingOlder(false);
    }
  };

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

    fresh.current.add(saved.id);
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
  const current = useRef<{
    session: Session | null;
    messages: Message[];
    complete: boolean;
  }>({ session: null, messages: [], complete: true });
  useEffect(() => {
    current.current = { session, messages, complete };
  }, [session, messages, complete]);

  /**
   * Hand the 壁打ち being left over to the background extractor.
   *
   * Fire-and-forget by design: the student is on their way somewhere, and the
   * thing that does the work lives in the layout, so it outlives this screen.
   */
  const handOff = useCallback(
    (minNew: number) => {
      const { session: leaving, messages: transcript, complete } = current.current;
      if (!leaving || !user) return;

      const hand = (full: Message[]) => {
        if (!hasNewMaterial(leaving, full, minNew)) return;
        startExtraction({
          session: leaving,
          messages: full,
          onRead: (extractedCount) =>
            // Only if this screen is still showing the same 壁打ち — by the time
            // this lands, the student is usually looking at a different one.
            setSession((prev) =>
              prev && prev.id === leaving.id ? { ...prev, extractedCount } : prev,
            ),
        });
      };

      // What is on screen is the end of the conversation, which is the right
      // thing to *read* and the wrong thing to extract from: `extractedCount`
      // counts lines from the beginning, and a STAR card needs the situation
      // as well as the result. So a truncated view fetches the rest first.
      // Nobody is waiting on this — it runs after the student has left.
      if (complete) {
        hand(transcript);
        return;
      }
      void getWholeTranscript(user.uid, leaving.id)
        .then(hand)
        .catch((e) => console.error("[extraction] 全文を読み込めませんでした", e));
    },
    [startExtraction, user],
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

  const streamed = stripProgressMarkers(streaming);

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

      {/* Directly under the header and outside the scroller, so 「あと何を話せば
          終わりなのか」 is answered without scrolling back up for it. */}
      <ProgressRail steps={session.progress} accent={accent} />

      {/* transcript */}
      <div
        ref={scrollerRef}
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
        {/* Only when there is something above. The button says 読み込む either
            way, because whether the next lines are already in memory or still
            in Firestore is not a distinction the student made. */}
        {(hidden > 0 || !complete) && (
          <button
            type="button"
            onClick={() => void revealOlder()}
            disabled={loadingOlder}
            style={{
              display: "block",
              margin: "0 auto 14px",
              padding: "7px 18px",
              borderRadius: 999,
              border: `1px solid ${T.line}`,
              background: T.paper,
              color: T.sub,
              fontSize: fs(11),
              fontWeight: 700,
              opacity: loadingOlder ? 0.5 : 1,
              cursor: loadingOlder ? "default" : "pointer",
            }}
          >
            {loadingOlder ? "読み込んでいます…" : "以前のメッセージを読み込む"}
          </button>
        )}

        {/* Sliced from `hidden` rather than mapped whole, but indexed against
            the full transcript: an ad slot's place in a conversation is where
            it falls in the conversation, not where it falls in today's view. */}
        {messages.slice(hidden).map((m, j) => {
          const i = hidden + j;
          return (
            // Fragment rather than a wrapper, so the bubbles stay siblings and
            // nothing about the transcript's layout depends on whether a slot
            // happens to fall here.
            <Fragment key={m.id}>
              <Bubble who={m.role} mode={m.mode ?? mode} fade={fresh.current.has(m.id)}>
                {m.text}
              </Bubble>
              {/* Every AD_INTERVAL messages, and never under the last one —
                  see adSlotFollows. The index keeps successive slots from
                  being the same card three times down one conversation. */}
              {adSlotFollows(i, messages.length) && (
                <AdSlot index={Math.floor(i / AD_INTERVAL)} />
              )}
            </Fragment>
          );
        })}

        {thinking && (
          <Bubble who="ai" mode={mode} fade>
            {/* Markers are stripped on the way to the screen as well as on the
                way to Firestore: a reply is rendered while it is still being
                written, so 「[progress:situation]」 would otherwise be on screen
                for as long as the last chunk takes to arrive. The partial form
                counts too — a tail of 「[progr」 is a marker that has not
                finished landing, not something the student wrote. */}
            {streamed ? (
              <span aria-live="polite">{streamed}</span>
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
            it is for rather than under the whole window.

            sc-composer is what globals.css watches to know the keyboard is up:
            while the field inside here has focus, the tab bar is not drawn. */}
        <div
          className="sc-composer sc-readable"
          style={{ display: "flex", gap: 8, alignItems: "flex-end" }}
        >
          {/*
            A div rather than a form. A form submits on Enter wherever the
            caret is, which is exactly the behaviour being removed — and on a
            phone there is no second key to press instead, so the student was
            left with a box that could not hold a second line.
          */}
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKeyDown}
            rows={1}
            placeholder="自分の言葉で書いてみる…"
            aria-label="メッセージ"
            style={{
              flex: 1,
              minWidth: 0,
              // Grown to fit by the effect below; the cap is what makes it
              // scroll rather than take the screen.
              maxHeight: COMPOSER_MAX_HEIGHT,
              padding: "11px 14px",
              borderRadius: 12,
              border: `1.5px solid ${T.line}`,
              // fieldFs, not fs: under 16px iOS zooms the whole app in the
              // moment this takes focus, and never zooms back out.
              fontSize: fieldFs(12.5),
              lineHeight: 1.6,
              color: T.ink,
              background: T.bg,
              outline: "none",
              // A textarea comes with a resize grabber and a scrollbar gutter
              // that an input never had. Neither belongs on a chat composer.
              resize: "none",
              overflowY: "auto",
              fontFamily: "inherit",
            }}
          />
          <button
            type="button"
            onClick={() => void send()}
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
        </div>
      </div>
    </div>
  );
}
