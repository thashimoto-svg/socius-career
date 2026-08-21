"use client";

import { useEffect, useState } from "react";
import {
  FIELD_MAX,
  PROGRESS_STEPS,
  type Worksheet,
} from "@socius/prompts";
import { fieldFs, fs, T } from "@/lib/theme";

/**
 * いま何がわかっているのか、そのものを開いて見せる。
 *
 * 進捗レールは「あと何を話せば終わりか」には答えるが、「何が埋まったことに
 * なっているのか」には答えない。行動の欄が埋まっているのに、学生の記憶では
 * まだ何も決まっていない——というずれは、レールでは見えず、次の問いになって
 * 初めて表に出る。そのとき学生に見えるのは「話が噛み合わないAI」であって、
 * 直せる場所ではない。
 *
 * 開けるようにしたのは、シートがただの表示物ではなくなったから。ここに書いて
 * あることは毎ターンAIに同封され、履歴から溢れた話の代わりに使われる。つまり
 * これは会話の記憶そのもので、間違ったまま置いておくと会話全体に効き続ける。
 * 読めて直せることは、機能というより前提のほうに近い。
 *
 * 直した内容は次のターンから効く。いま書かれている途中の返答は書き直さない
 * ——それはもう学生が読んでいる文章で、遡って別のものにするのは会話ではない。
 */

const LABELS: Record<string, string> = {
  episode: "エピソード",
  motive: "動機(なぜそうしようと思ったか)",
};

/** 一行で入る欄と、そうでない欄。 */
const SHORT = new Set(["episode"]);

type Field = { id: keyof Worksheet & string; label: string; asks: string };

/** 画面に並ぶ順。シートのプロトコルと同じ並びで、同じ意味。 */
const FIELDS: Field[] = [
  { id: "episode", label: LABELS.episode, asks: "いま話している経験" },
  ...PROGRESS_STEPS.map((s) => ({ id: s.id, label: s.label, asks: s.asks })),
  { id: "motive", label: LABELS.motive, asks: "その選択の理由" },
];

export function WorksheetPanel({
  worksheet,
  accent,
  readOnly,
  saving,
  error,
  onSave,
  onClose,
}: {
  worksheet: Worksheet;
  accent: string;
  /** 返答を書いているあいだは読むだけ。 */
  readOnly: boolean;
  saving: boolean;
  error: string | null;
  onSave: (next: Worksheet) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Worksheet>(worksheet);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const set = (id: string, value: string) =>
    setDraft((prev) => ({ ...prev, [id]: value.slice(0, FIELD_MAX) }));

  const changed = JSON.stringify(draft) !== JSON.stringify(worksheet);

  return (
    <>
      <div
        className="sc-scrim"
        onClick={() => !saving && onClose()}
        aria-hidden="true"
        style={{ position: "fixed", inset: 0, background: T.scrim, zIndex: 70 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-sheet-title"
        className="sc-fade"
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 71,
          width: "min(560px, calc(100% - 28px))",
          // 欄が9つあるので、画面より高くなる端末のほうが多い。カードの中だけが
          // 動くようにして、背後の会話は動かさない。
          maxHeight: "86dvh",
          display: "flex",
          flexDirection: "column",
          background: T.paper,
          border: `1px solid ${T.line}`,
          borderRadius: 16,
          boxShadow: `0 10px 30px ${T.shadow}`,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "16px 16px 10px",
            borderBottom: `1px solid ${T.line}`,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              id="sc-sheet-title"
              className="sc-display"
              style={{ fontSize: fs(13.5), fontWeight: 700, color: T.ink, lineHeight: 1.6 }}
            >
              ここまでの整理
            </div>
            <div style={{ fontSize: fs(10.5), color: T.sub, lineHeight: 1.7, marginTop: 4 }}>
              {readOnly
                ? "返答を書いているあいだは直せません。書き終わるまで待ってください"
                : "違うところは直せます。直した内容は次の返答から使われます"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="閉じる"
            style={{
              flexShrink: 0,
              border: "none",
              background: "none",
              padding: "2px 4px",
              color: T.sub,
              fontSize: fs(13),
              lineHeight: 1.2,
              cursor: saving ? "default" : "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px 4px" }}>
          {FIELDS.map((field) => {
            const value = String(draft[field.id] ?? "");
            return (
              <div key={field.id} style={{ marginBottom: 12 }}>
                <label
                  htmlFor={`sc-sheet-${field.id}`}
                  style={{
                    display: "block",
                    fontSize: fs(10.5),
                    fontWeight: 700,
                    color: value ? accent : T.sub,
                    marginBottom: 4,
                  }}
                >
                  {field.label}
                </label>
                <textarea
                  id={`sc-sheet-${field.id}`}
                  value={value}
                  onChange={(e) => set(field.id, e.target.value)}
                  readOnly={readOnly}
                  rows={SHORT.has(field.id) ? 1 : 2}
                  maxLength={FIELD_MAX}
                  // 空欄に「いつ・どこで・どんな場面だったか」を出す。ここは
                  // 学生が自分で埋めにいける場所でもあるので、何を書く欄なのか
                  // が空のときにこそ要る。
                  placeholder={`まだ — ${field.asks}`}
                  style={{
                    width: "100%",
                    padding: "9px 11px",
                    borderRadius: 10,
                    border: `1.5px solid ${T.line}`,
                    background: readOnly ? T.bg : T.paper,
                    color: T.ink,
                    // fieldFs: 16px を切ると iOS がタップの瞬間に画面ごと
                    // 拡大して、戻らない。
                    fontSize: fieldFs(12),
                    lineHeight: 1.7,
                    fontFamily: "inherit",
                    resize: "none",
                    outline: "none",
                  }}
                />
              </div>
            );
          })}

          {/*
            未回収の話題。AIが脱線を控えておく場所で、学生が足す場所ではない
            ——足せるようにすると、アプリが必ず聞き返すと約束したto-doに見える。
            消せるだけにしてあるのは、間違って控えられたものを黙らせる必要が
            あるから。
          */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: fs(10.5),
                fontWeight: 700,
                color: draft.pending.length ? accent : T.sub,
                marginBottom: 6,
              }}
            >
              あとで聞く話
            </div>
            {draft.pending.length === 0 ? (
              <div style={{ fontSize: fs(11), color: T.sub, lineHeight: 1.7 }}>
                まだありません
              </div>
            ) : (
              draft.pending.map((item, i) => (
                <div
                  key={`${i}-${item}`}
                  style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}
                >
                  <input
                    value={item}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        pending: prev.pending.map((p, j) =>
                          j === i ? e.target.value.slice(0, FIELD_MAX) : p,
                        ),
                      }))
                    }
                    readOnly={readOnly}
                    aria-label={`あとで聞く話 ${i + 1}`}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "8px 11px",
                      borderRadius: 10,
                      border: `1.5px solid ${T.line}`,
                      background: readOnly ? T.bg : T.paper,
                      color: T.ink,
                      fontSize: fieldFs(12),
                      fontFamily: "inherit",
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        pending: prev.pending.filter((_, j) => j !== i),
                      }))
                    }
                    aria-label={`「${item}」を消す`}
                    style={{
                      flexShrink: 0,
                      border: "none",
                      background: "none",
                      padding: "4px 6px",
                      color: T.sub,
                      fontSize: fs(12),
                      cursor: readOnly ? "default" : "pointer",
                      opacity: readOnly ? 0.4 : 1,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          {error && (
            <div
              role="alert"
              style={{
                marginBottom: 12,
                padding: "8px 11px",
                borderRadius: 10,
                background: T.karakuchiSoft,
                color: T.karakuchi,
                fontSize: fs(11),
                lineHeight: 1.7,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            flexShrink: 0,
            display: "flex",
            gap: 8,
            padding: "10px 16px 14px",
            borderTop: `1px solid ${T.line}`,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 10,
              border: `1.5px solid ${T.line}`,
              background: T.paper,
              color: T.sub,
              fontSize: fs(11.5),
              fontWeight: 700,
              opacity: saving ? 0.5 : 1,
              cursor: saving ? "default" : "pointer",
            }}
          >
            {changed && !readOnly ? "やめる" : "閉じる"}
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={() => onSave(draft)}
              disabled={saving || !changed}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 10,
                border: "none",
                background: accent,
                color: T.onAccent,
                fontSize: fs(11.5),
                fontWeight: 700,
                opacity: saving || !changed ? 0.45 : 1,
                cursor: saving || !changed ? "default" : "pointer",
              }}
            >
              {saving ? "保存しています…" : "保存する"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
