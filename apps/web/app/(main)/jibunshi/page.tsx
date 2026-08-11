"use client";

import { useEffect, useRef, useState } from "react";
import { EPISODE_PERIODS, type EpisodePeriod } from "@socius/prompts";
import { AppHeader } from "@/components/AppHeader";
import { JibunshiTimeline } from "@/components/JibunshiTimeline";
import { ScreenError, ScreenLoading } from "@/components/screen-state";
import { useAuth } from "@/lib/firebase/auth-context";
import {
  deleteEpisode,
  listEpisodes,
  updateEpisode,
} from "@/lib/firebase/episodes";
import type { Episode, Star } from "@/lib/firebase/schema";
import { bucketByPeriod } from "@/lib/jibunshi-periods";
import { useLoadable } from "@/lib/use-loadable";
import { fs, T } from "@/lib/theme";

/** What an edit can change. The AI's tag and emotion are not the student's to retype. */
type EpisodePatch = {
  title: string;
  period: EpisodePeriod;
  star: Star;
  learn: string;
};

const STAR_LABELS: { key: keyof Star; label: string }[] = [
  { key: "S", label: "状況" },
  { key: "T", label: "課題" },
  { key: "A", label: "行動" },
  { key: "R", label: "結果" },
];

// Every card holds the student's own words, structured as STAR + 学び + 感情 —
// never a loose blob of text, and never rewritten into the AI's voice.
// TODO(v0.2): Markdown export.
export default function JibunshiPage() {
  const { user } = useAuth();
  const loaded = useLoadable(user?.uid ?? null, listEpisodes, {
    message: "エピソードを読み込めませんでした。",
  });

  // The screen keeps its own copy of what it loaded, because these cards are
  // the student's to edit and delete: an edit has to show up the moment it is
  // made, not when a re-read agrees that it happened.
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Where each card ended up, so the timeline above can send the student to one.
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    setEpisodes(loaded.data);
    // Newest first, so the top card is the one they just made.
    setOpenId(loaded.data?.[0]?.id ?? null);
  }, [loaded.data]);

  /** Open the card the student picked off the timeline, and go to it. */
  const revealEpisode = (id: string) => {
    setOpenId(id);
    setEditingId(null);
    // Next frame: the card has to have expanded before its position is worth
    // scrolling to, or the student lands above it and has to scroll again.
    requestAnimationFrame(() => {
      cardRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleSave = async (id: string, patch: EpisodePatch) => {
    if (!user) return;
    // Optimistic: the student just typed these words, so showing them straight
    // away is more honest than a spinner over their own text.
    setEpisodes((rows) =>
      rows?.map((e) => (e.id === id ? { ...e, ...patch } : e)) ?? rows,
    );
    setEditingId(null);
    await updateEpisode(user.uid, id, patch);
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    if (!window.confirm("このエピソードを削除しますか? 元に戻せません。")) return;
    setEpisodes((rows) => rows?.filter((e) => e.id !== id) ?? rows);
    await deleteEpisode(user.uid, id);
  };

  return (
    <>
      <AppHeader title="自分史" />
      {/* The shell no longer scrolls, so every screen owns the panel that does. */}
      <div
        className="sc-readable"
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 16px" }}
      >
      <p style={{ fontSize: fs(11.5), color: T.sub, margin: "0 0 16px" }}>
        ここにある言葉は、すべてあなた自身が話したことです。
      </p>

      {loaded.error && <ScreenError message={loaded.error} onRetry={loaded.retry} />}

      {/*
        The year table comes first, and is drawn whether or not there is
        anything to put on it. A student with nothing saved should see the shape
        of what they are filling in, not a screen that says まだありません.
      */}
      {!loaded.error && (
        <JibunshiTimeline
          buckets={bucketByPeriod(episodes ?? [])}
          onPick={revealEpisode}
          loading={episodes === null}
        />
      )}

      {loaded.loading && <ScreenLoading />}

      {episodes?.length === 0 && (
        <div style={{ fontSize: fs(12.5), color: T.sub, lineHeight: 1.9 }}>
          壁打ちで具体的な出来事を話すと、
          <br />
          あなたの言葉がこの年表に STAR で並びます。
        </div>
      )}

      {episodes && episodes.length > 0 && (
        <h2
          className="sc-display"
          style={{ fontSize: fs(13), fontWeight: 700, margin: "0 0 10px", color: T.ink }}
        >
          エピソード
        </h2>
      )}

      {episodes?.map((e) => {
        const isOpen = openId === e.id;
        const bodyId = `episode-${e.id}`;
        return (
          <div
            key={e.id}
            ref={(node) => {
              if (node) cardRefs.current.set(e.id, node);
              else cardRefs.current.delete(e.id);
            }}
            style={{
              background: T.paper,
              border: `1px solid ${isOpen ? T.gold : T.line}`,
              borderLeft: `4px solid ${T.gold}`,
              borderRadius: 14,
              marginBottom: 12,
              // The card is what the timeline scrolls to, so it must not land
              // flush against the header.
              scrollMarginTop: 12,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : e.id)}
              aria-expanded={isOpen}
              aria-controls={bodyId}
              style={{
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                padding: "13px 15px",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: fs(10),
                    fontWeight: 700,
                    color: T.primary,
                    background: T.primarySoft,
                    padding: "2px 8px",
                    borderRadius: 999,
                  }}
                >
                  {e.tag}
                </span>
                {/* 不明 is shown rather than hidden: it is the one thing on the
                    card the student can fix, and 編集する is right below. */}
                <span
                  style={{
                    fontSize: fs(10),
                    fontWeight: 700,
                    color: e.period === "不明" ? T.sub : T.goldInk,
                    background: e.period === "不明" ? T.bg : T.goldSoft,
                    padding: "2px 8px",
                    borderRadius: 999,
                  }}
                >
                  {e.period === "不明" ? "時期未設定" : e.period}
                </span>
                {e.emotion && (
                  <span style={{ fontSize: fs(10), color: T.sub }}>感情: {e.emotion}</span>
                )}
              </div>
              <div className="sc-display" style={{ fontSize: fs(14.5), fontWeight: 700, color: T.ink }}>
                {e.title}
              </div>
            </button>

            {isOpen && editingId === e.id && (
              <EpisodeEditor
                episode={e}
                onCancel={() => setEditingId(null)}
                onSave={(patch) => handleSave(e.id, patch)}
              />
            )}

            {isOpen && editingId !== e.id && (
              <div id={bodyId} className="sc-fade" style={{ padding: "0 15px 13px" }}>
                {STAR_LABELS.map(({ key, label }) => (
                  <div key={key} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                    <div
                      style={{
                        minWidth: 34,
                        height: 22,
                        borderRadius: 6,
                        background: T.bg,
                        color: T.primary,
                        fontSize: fs(10.5),
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {key}・{label}
                    </div>
                    <div style={{ fontSize: fs(12.5), lineHeight: 1.7 }}>{e.star[key]}</div>
                  </div>
                ))}

                <div
                  style={{
                    background: T.goldSoft,
                    borderRadius: 10,
                    padding: "9px 12px",
                    margin: "10px 0",
                  }}
                >
                  <div style={{ fontSize: fs(10), fontWeight: 700, color: T.goldInk, marginBottom: 3 }}>
                    学び ── 自分の言葉で
                  </div>
                  <div className="sc-display" style={{ fontSize: fs(12.5), lineHeight: 1.7 }}>
                    {e.learn}
                  </div>
                </div>

                {/* Ownership: the student can edit and delete. Export lands in
                    v0.2 — until it does something, a dead button is only a
                    thing the student tries and fails to press. */}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setEditingId(e.id)}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: 9,
                      border: `1.5px solid ${T.line}`,
                      background: T.paper,
                      fontSize: fs(11.5),
                      fontWeight: 700,
                      color: T.ink,
                      cursor: "pointer",
                    }}
                  >
                    編集する
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(e.id)}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: 9,
                      border: `1.5px solid ${T.line}`,
                      background: T.paper,
                      fontSize: fs(11.5),
                      fontWeight: 700,
                      color: T.karakuchi,
                      cursor: "pointer",
                    }}
                  >
                    削除する
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      </div>
    </>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: `1.5px solid ${T.line}`,
  background: T.bg,
  color: T.ink,
  fontSize: fs(12.5),
  lineHeight: 1.7,
  fontFamily: "inherit",
  resize: "vertical",
};

/**
 * Inline editing rather than a separate route: the student is correcting a
 * sentence they can see, and losing the surrounding card would make the edit
 * feel like filling in a form about themselves.
 */
function EpisodeEditor({
  episode,
  onCancel,
  onSave,
}: {
  episode: Episode;
  onCancel: () => void;
  onSave: (patch: EpisodePatch) => void;
}) {
  const [title, setTitle] = useState(episode.title);
  const [period, setPeriod] = useState<EpisodePeriod>(episode.period);
  const [star, setStar] = useState<Star>(episode.star);
  const [learn, setLearn] = useState(episode.learn);

  return (
    <div className="sc-fade" style={{ padding: "0 15px 13px" }}>
      <label style={{ display: "block", fontSize: fs(10), color: T.sub, marginBottom: 4 }}>
        タイトル
      </label>
      <input value={title} onChange={(ev) => setTitle(ev.target.value)} style={fieldStyle} />

      {/*
        Extraction only records a period when the student said one out loud, so
        a card that arrived as 時期未設定 has nowhere to sit on the year table
        until someone places it. This is that someone.
      */}
      <label
        htmlFor={`period-${episode.id}`}
        style={{ display: "block", fontSize: fs(10), color: T.sub, margin: "10px 0 4px" }}
      >
        時期
      </label>
      <select
        id={`period-${episode.id}`}
        value={period}
        onChange={(ev) => setPeriod(ev.target.value as EpisodePeriod)}
        style={{ ...fieldStyle, resize: undefined }}
      >
        {EPISODE_PERIODS.map((p) => (
          <option key={p} value={p}>
            {p === "不明" ? "時期未設定" : p}
          </option>
        ))}
      </select>

      {STAR_LABELS.map(({ key, label }) => (
        <div key={key} style={{ marginTop: 10 }}>
          <label style={{ display: "block", fontSize: fs(10), color: T.sub, marginBottom: 4 }}>
            {key}・{label}
          </label>
          <textarea
            rows={2}
            value={star[key]}
            onChange={(ev) => setStar((s) => ({ ...s, [key]: ev.target.value }))}
            style={fieldStyle}
          />
        </div>
      ))}

      <div style={{ marginTop: 10 }}>
        <label style={{ display: "block", fontSize: fs(10), color: T.sub, marginBottom: 4 }}>
          学び ── 自分の言葉で
        </label>
        <textarea
          rows={2}
          value={learn}
          onChange={(ev) => setLearn(ev.target.value)}
          style={fieldStyle}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={() => onSave({ title, period, star, learn })}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 9,
            border: "none",
            background: T.primary,
            color: T.onAccent,
            fontSize: fs(11.5),
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          保存する
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 9,
            border: `1.5px solid ${T.line}`,
            background: T.paper,
            fontSize: fs(11.5),
            fontWeight: 700,
            color: T.sub,
            cursor: "pointer",
          }}
        >
          やめる
        </button>
      </div>
    </div>
  );
}
