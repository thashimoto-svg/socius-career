"use client";

import { AppHeader } from "@/components/AppHeader";
import { useSettings } from "@/components/settings-provider";
import type { FontSize, ThemeChoice } from "@/lib/firebase/settings";
import { fs, T } from "@/lib/theme";

const FONT_SIZES: { id: FontSize; label: string }[] = [
  { id: "small", label: "小" },
  { id: "normal", label: "標準" },
  { id: "large", label: "大" },
];

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: "light", label: "ライト" },
  { id: "dark", label: "ダーク" },
  { id: "system", label: "端末に合わせる" },
];

export default function SettingsPage() {
  const { settings, update } = useSettings();

  return (
    <>
      <AppHeader title="設定" />

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 16px" }}>
        <Section title="文字サイズ">
          <Choices
            options={FONT_SIZES}
            current={settings.fontSize}
            onPick={(fontSize) => update({ fontSize })}
            label="文字サイズ"
          />
          {/* Set at a fixed size, so it stays a reference point rather than
              growing along with the thing it is describing. */}
          <p style={{ fontSize: "12px", color: T.sub, lineHeight: 1.9, margin: "10px 0 0" }}>
            この一文だけは大きさが変わりません。上のサンプルと見比べてください。
          </p>
          <p style={{ fontSize: fs(12.5), color: T.ink, lineHeight: 1.9, margin: "4px 0 0" }}>
            サッカー部で、集合時間を10分前倒しにしたいと提案しました。
          </p>
        </Section>

        <Section title="テーマ">
          <Choices
            options={THEMES}
            current={settings.theme}
            onPick={(theme) => update({ theme })}
            label="テーマ"
          />
        </Section>

        <Section title="言語 / Language">
          <div style={{ display: "flex", gap: 8 }}>
            <div
              aria-current="true"
              style={{
                flex: 1,
                padding: "9px 0",
                textAlign: "center",
                borderRadius: 10,
                border: `1.5px solid ${T.primary}`,
                background: T.primarySoft,
                color: T.primary,
                fontSize: fs(12),
                fontWeight: 700,
              }}
            >
              日本語
            </div>
            {/*
              Present, and plainly not ready. Leaving English off the screen
              entirely would say nothing; a button that silently did nothing
              would say something false.
            */}
            <div
              aria-disabled="true"
              style={{
                flex: 1,
                padding: "9px 0",
                textAlign: "center",
                borderRadius: 10,
                border: `1.5px dashed ${T.line}`,
                background: T.bg,
                color: T.sub,
                fontSize: fs(12),
                fontWeight: 700,
              }}
            >
              English
              <span style={{ display: "block", fontSize: fs(9.5), fontWeight: 400 }}>
                Coming soon
              </span>
            </div>
          </div>
        </Section>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h2
        className="sc-display"
        style={{ fontSize: fs(13), fontWeight: 700, color: T.ink, margin: "0 0 8px" }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A segmented row. Radios rather than buttons — one of these is always true. */
function Choices<Id extends string>({
  options,
  current,
  onPick,
  label,
}: {
  options: { id: Id; label: string }[];
  current: Id;
  onPick: (id: Id) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: 8 }}>
      {options.map((option) => {
        const selected = option.id === current;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onPick(option.id)}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 10,
              border: `1.5px solid ${selected ? T.primary : T.line}`,
              background: selected ? T.primarySoft : T.paper,
              color: selected ? T.primary : T.sub,
              fontSize: fs(12),
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
