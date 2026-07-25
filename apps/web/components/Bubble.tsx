import type { ReactNode } from "react";
import { T } from "@/lib/theme";

export type ChatMode = "counselor" | "karakuchi";

type BubbleProps = {
  who: "ai" | "user";
  mode?: ChatMode;
  children: ReactNode;
};

/** A single chat message bubble. AI bubbles tint to the active mode's accent. */
export function Bubble({ who, mode = "counselor", children }: BubbleProps) {
  const ai = who === "ai";
  const accent = mode === "karakuchi" ? T.karakuchiSoft : T.primarySoft;
  return (
    <div
      className="sc-fade"
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
          fontSize: 13.5,
          lineHeight: 1.75,
          background: ai ? accent : T.ink,
          color: ai ? T.ink : "#fff",
          borderRadius: ai ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
        }}
      >
        {children}
      </div>
    </div>
  );
}
