"use client";

import { fs, T } from "@/lib/theme";
import type { ChatMode } from "@/lib/firebase/schema";

/**
 * 答え方の見本を、押せる形で。
 *
 * βフィードバック 8/18:「何を書けばいいか分からなくて止まる」。ルール7はすでに
 * 「選びやすい切り口を2〜3個示して問い直す」と言っていて、AIは実際そうしていた
 * ——ただし文章の中で。「部活のことでも、バイトのことでも構いません」は、読む
 * ぶんには親切だが、空の入力欄の前では選択肢に見えない。
 *
 * 押すとそのまま自分の発言として送られる。確認は挟まない——挟むと二手になり、
 * 一手で済ませるためだけに存在するものが一手も減らさなくなる。押し間違えたら
 * 発言を消せる(sprint1)ので、取り返しはついている。
 *
 * 「その他」は無い。入力欄はこの下でいつでも空いていて、常に隣にあるものに
 * 「その他」を足すと、選ぶことが義務のように見えてしまう。
 */

type ReplyChoicesProps = {
  choices: string[];
  mode: ChatMode;
  /** 返答を書いている最中は押せない。送る先の会話がまだ動いている。 */
  disabled: boolean;
  onChoose: (choice: string) => void;
};

export function ReplyChoices({ choices, mode, disabled, onChoose }: ReplyChoicesProps) {
  if (choices.length === 0) return null;
  const accent = mode === "karakuchi" ? T.karakuchi : T.primary;
  const soft = mode === "karakuchi" ? T.karakuchiSoft : T.primarySoft;

  return (
    <div
      // AIの吹き出しの下に、同じ左端から。返答の一部として読めるように。
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 7,
        margin: "-2px 0 12px",
      }}
    >
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          onClick={() => onChoose(choice)}
          disabled={disabled}
          style={{
            // 44pxには届かないが、横幅が本文ぶんあるので指は迷わない。会話の上に
            // 常駐するものではなく、一度押されたら消えるもの。
            padding: "8px 14px",
            borderRadius: 999,
            border: `1.5px solid ${accent}`,
            background: soft,
            color: accent,
            fontSize: fs(12),
            fontWeight: 700,
            lineHeight: 1.5,
            textAlign: "left",
            opacity: disabled ? 0.45 : 1,
            cursor: disabled ? "default" : "pointer",
          }}
        >
          {choice}
        </button>
      ))}
    </div>
  );
}
