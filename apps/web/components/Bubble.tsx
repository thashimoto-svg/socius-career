import type { ReactNode } from "react";
import type { ChatMode } from "@/lib/firebase/schema";
import { fs, T } from "@/lib/theme";

type BubbleProps = {
  who: "ai" | "user";
  mode?: ChatMode;
  /**
   * Whether this bubble is arriving now.
   *
   * The entrance animation is how a new turn announces itself, so it belongs
   * to messages that appear rather than to messages that are present. Off by
   * default: re-opening a 壁打ち drew its whole transcript at once, and every
   * line playing the same 「something just happened」 animation was both a lie
   * and, on a phone, the most expensive frame of the screen's life.
   */
  fade?: boolean;
  /**
   * Whether the student has since corrected these words.
   *
   * Said out loud rather than left to the diff nobody can see. The transcript
   * is what the 自分史 is extracted from and what the next request is built
   * from, so a line that can change has to admit that it did — otherwise the
   * record and the memory of it come apart with nothing on screen to say when.
   */
  edited?: boolean;
  children: ReactNode;
};

/** A single chat message bubble. AI bubbles tint to the active mode's accent. */
export function Bubble({
  who,
  mode = "counselor",
  fade = false,
  edited = false,
  children,
}: BubbleProps) {
  const ai = who === "ai";
  const accent = mode === "karakuchi" ? T.karakuchiSoft : T.primarySoft;
  return (
    <div
      className={fade ? "sc-fade" : undefined}
      style={{
        display: "flex",
        justifyContent: ai ? "flex-start" : "flex-end",
        marginBottom: 10,
      }}
    >
      <div
        style={{
          maxWidth: "82%",
          padding: "10px 13px",
          fontSize: fs(13.5),
          lineHeight: 1.75,
          background: ai ? accent : T.ink,
          color: ai ? T.ink : T.onAccent,
          borderRadius: ai ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
          // The student's own words keep their line breaks. They were typed
          // with 改行, and a paragraph collapsed into one run is not what they
          // wrote.
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {children}
        {edited && (
          <span
            style={{
              display: "block",
              marginTop: 4,
              fontSize: fs(9.5),
              opacity: 0.6,
              textAlign: "right",
            }}
          >
            編集済み
          </span>
        )}
      </div>
    </div>
  );
}
