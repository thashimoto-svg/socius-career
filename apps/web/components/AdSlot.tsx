"use client";

import { adsEnabled } from "@/lib/ads";
import { fs, T } from "@/lib/theme";

/**
 * The advertising slot.
 *
 * Everything about where a slot goes is decided by the screens that render this
 * — how often, how far down, whether at all. Everything about what a slot *is*
 * is decided in here. That line is the whole point of the component: when a
 * network goes in, this file's body is replaced and no screen is touched.
 *
 * Today the body is a house notice, which is not a placeholder in the sense of
 * a grey box. A grey box measures the space and tells you nothing about how the
 * screen reads with something in it; a real card in the real style does. It is
 * also the honest thing to put in a beta — a student who taps one gets
 * something of ours rather than a dead rectangle.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NOTE FOR THE TEAM: the notices below are copy, and copy nobody has signed
 * off. They name things the app does not do yet. Rewrite or cut them before
 * the beta goes out — an announcement is a promise, and these were written to
 * fill a slot, not to be kept.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Notice = {
  /** The small line above. What kind of thing this is. */
  kicker: string;
  title: string;
  body: string;
};

const NOTICES: Notice[] = [
  {
    kicker: "Socius Career からのお知らせ",
    title: "話した分だけ、自分史は埋まります",
    body: "壁打ちのあとに残ったエピソードは、自分史の画面からいつでも読み返せます。",
  },
  {
    kicker: "Socius Career からのお知らせ",
    title: "書いた内容は、あなただけのものです",
    body: "壁打ちの記録も自分史も、本人以外は読めません。安心して、思いついたことから書いてみてください。",
  },
  {
    kicker: "Socius Career からのお知らせ",
    title: "言いにくいことほど、書いてみる価値があります",
    body: "うまくまとまっていなくて大丈夫です。整理するところから一緒にやるための壁打ちです。",
  },
];

type AdSlotProps = {
  /**
   * Which notice to show. Slots down a long 壁打ち would otherwise all be the
   * same card, which reads less like an announcement than like a bug.
   */
  index?: number;
};

export function AdSlot({ index = 0 }: AdSlotProps) {
  // The switch. `off` means this renders nothing — not an empty box with
  // margins, which is a gap in the page that nobody can explain.
  if (!adsEnabled) return null;

  const notice = NOTICES[index % NOTICES.length];

  return (
    <div
      // Announced as what it is. A student using a screen reader should not
      // have to work out that the thing between two messages is not one of
      // them, and this is the attribute that will still be correct when the
      // body of this file is a network's iframe.
      role="complementary"
      aria-label="お知らせ"
      style={{
        margin: "14px 0",
        padding: "12px 14px",
        borderRadius: 12,
        border: `1px dashed ${T.line}`,
        // Deliberately quieter than the cards the student's own words live in.
        // A notice that competes with the 自分史 for attention is a notice that
        // has been given more of the screen than it earned.
        background: T.bg,
      }}
    >
      <div
        style={{
          fontSize: fs(9.5),
          fontWeight: 700,
          color: T.sub,
          letterSpacing: "0.04em",
        }}
      >
        {notice.kicker}
      </div>
      <div
        style={{
          marginTop: 5,
          fontSize: fs(12),
          fontWeight: 700,
          color: T.ink,
          lineHeight: 1.7,
        }}
      >
        {notice.title}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: fs(11),
          color: T.sub,
          lineHeight: 1.8,
        }}
      >
        {notice.body}
      </div>
    </div>
  );
}
