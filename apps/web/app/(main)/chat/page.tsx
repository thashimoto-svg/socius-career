"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Bubble, type ChatMode } from "@/components/Bubble";
import { T } from "@/lib/theme";

type Turn =
  | { who: "user"; text: string }
  | { who: "ai"; counselor: ReactNode; karakuchi: ReactNode };

/**
 * Seeded conversation for the prototype.
 *
 * Both mode variants ask the SAME next question — style changes tone only.
 * The 抽象語→具体化 demand is invariant across modes (企画書 4.1), so keep the
 * depth identical when editing these lines.
 *
 * TODO(gemini): replace with the session's real turns; mode variants come from
 * packages/prompts/modes.
 */
const TURNS: Turn[] = [
  { who: "user", text: "自分の強みは、努力家なところだと思います。" },
  {
    who: "ai",
    counselor: (
      <>
        そう感じられるのは素敵ですね。ただ「努力家」は面接ではよく出る言葉なので、あなたの努力を具体的に見せてもらえますか?
        <b> いつ・何を・どのくらい</b>続けたか、ひとつ思い出してみましょう。
      </>
    ),
    karakuchi: (
      <>
        「努力家」だけだと面接官には何も残りません。あなたにしか言えない事実に落としましょう。
        <b>いつ・何を・どのくらい</b>続けた? 数字で言えるものはある?
      </>
    ),
  },
  {
    who: "user",
    text: "怪我で3ヶ月離脱したとき、毎朝30分試合映像を見てノートをつけていました。",
  },
  {
    who: "ai",
    counselor: (
      <>
        3ヶ月、毎朝30分。それはもう「努力家」より強い言葉になっていますよ。では一歩だけ深く──
        <b>なぜ、映像とノートだったのでしょう?</b> 他の選択肢もあった中で。
      </>
    ),
    karakuchi: (
      <>
        いいですね、それが事実の強さです。次。<b>なぜ映像とノートを選んだ?</b>{" "}
        リハビリだけでもよかったはず。その判断にあなたが出ています。
      </>
    ),
  },
];

const MODES: { id: ChatMode; label: string }[] = [
  { id: "counselor", label: "じっくり(カウンセラー風)" },
  { id: "karakuchi", label: "ストレート(辛口)" },
];

export default function ChatPage() {
  const [mode, setMode] = useState<ChatMode>("counselor");
  // Turns the student adds during this prototype session. The AI reply is not
  // wired up yet, so only their own words are appended.
  const [sent, setSent] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const accent = mode === "karakuchi" ? T.karakuchi : T.primary;

  // TODO(gemini): POST to the chat route handler and stream the reply back.
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setSent((s) => [...s, text]);
    setDraft("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* theme + tone switch */}
      <div
        style={{
          padding: "12px 16px 10px",
          borderBottom: `1px solid ${T.line}`,
          background: T.paper,
        }}
      >
        {/* TODO(firebase): the theme is guided on the first session, then drawn
            from the student's onboarding answers and past episodes. */}
        <div style={{ fontSize: 11, color: T.sub, marginBottom: 6 }}>
          今日のテーマ: 部活を続けた理由
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
                onClick={() => setMode(m.id)}
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
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 14px 4px" }}>
        {TURNS.map((t, i) =>
          t.who === "user" ? (
            <Bubble key={i} who="user">
              {t.text}
            </Bubble>
          ) : (
            // Re-key on mode so the rewritten line fades in.
            <Bubble key={`${i}-${mode}`} who="ai" mode={mode}>
              {mode === "karakuchi" ? t.karakuchi : t.counselor}
            </Bubble>
          ),
        )}

        <div style={{ textAlign: "center", margin: "12px 0" }}>
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

        {sent.map((text, i) => (
          <Bubble key={`sent-${i}`} who="user">
            {text}
          </Bubble>
        ))}
      </div>

      {/* composer */}
      <div style={{ padding: "10px 12px", borderTop: `1px solid ${T.line}`, background: T.paper }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
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
            disabled={!draft.trim()}
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
              opacity: draft.trim() ? 1 : 0.45,
              cursor: draft.trim() ? "pointer" : "default",
            }}
          >
            ↑
          </button>
        </form>

        {/* TODO(gemini): run the STAR extraction prompt, then route to /jibunshi. */}
        <button
          type="button"
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
            cursor: "pointer",
          }}
        >
          セッションを終えて、エピソードとして残す
        </button>
      </div>
    </div>
  );
}
