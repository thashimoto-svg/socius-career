"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import {
  deleteEpisode,
  listEpisodes,
  updateEpisode,
} from "@/lib/firebase/episodes";
import type { Episode, Star } from "@/lib/firebase/schema";
import { T } from "@/lib/theme";

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
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    listEpisodes(user.uid)
      .then((rows) => {
        if (cancelled) return;
        setEpisodes(rows);
        setOpenId(rows[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSave = async (id: string, patch: Partial<Episode>) => {
    if (!user) return;
    // Optimistic: the student just typed these words, so showing them straight
    // away is more honest than a spinner over their own text.
    setEpisodes((rows) =>
      rows?.map((e) => (e.id === id ? { ...e, ...patch } : e)) ?? rows,
    );
    setEditingId(null);
    await updateEpisode(user.uid, id, {
      title: patch.title,
      star: patch.star,
      learn: patch.learn,
    });
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    if (!window.confirm("このエピソードを削除しますか? 元に戻せません。")) return;
    setEpisodes((rows) => rows?.filter((e) => e.id !== id) ?? rows);
    await deleteEpisode(user.uid, id);
  };

  return (
    <div style={{ padding: "20px 16px" }}>
      <h1 className="sc-display" style={{ fontSize: 18, fontWeight: 700 }}>
        自分史
      </h1>
      <p style={{ fontSize: 11.5, color: T.sub, margin: "4px 0 14px" }}>
        ここにある言葉は、すべてあなた自身が話したことです。
      </p>

      {error && (
        <div role="alert" style={{ fontSize: 12, color: T.karakuchi, lineHeight: 1.9 }}>
          エピソードを読み込めませんでした。ページを再読み込みしてください。
        </div>
      )}

      {!error && episodes === null && (
        <div style={{ fontSize: 12, color: T.sub }}>読み込んでいます…</div>
      )}

      {!error && episodes?.length === 0 && (
        <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.9 }}>
          まだエピソードはありません。
          <br />
          壁打ちを終えるときに「エピソードとして残す」を押すと、
          <br />
          話した言葉がここに STAR で並びます。
        </div>
      )}

      {episodes?.map((e) => {
        const isOpen = openId === e.id;
        const bodyId = `episode-${e.id}`;
        return (
          <div
            key={e.id}
            style={{
              background: T.paper,
              border: `1px solid ${isOpen ? T.gold : T.line}`,
              borderLeft: `4px solid ${T.gold}`,
              borderRadius: 14,
              marginBottom: 12,
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
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: T.primary,
                    background: T.primarySoft,
                    padding: "2px 8px",
                    borderRadius: 999,
                  }}
                >
                  {e.tag}
                </span>
                <span style={{ fontSize: 10, color: T.sub }}>感情: {e.emotion}</span>
              </div>
              <div className="sc-display" style={{ fontSize: 14.5, fontWeight: 700, color: T.ink }}>
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
                        fontSize: 10.5,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {key}・{label}
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>{e.star[key]}</div>
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
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#8a6420", marginBottom: 3 }}>
                    学び ── 自分の言葉で
                  </div>
                  <div className="sc-display" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                    {e.learn}
                  </div>
                </div>

                {/* Ownership: the student can edit, delete, and (v0.2) export. */}
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
                      fontSize: 11.5,
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
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: T.karakuchi,
                      cursor: "pointer",
                    }}
                  >
                    削除する
                  </button>
                  <button
                    type="button"
                    disabled
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: 9,
                      border: `1.5px solid ${T.line}`,
                      background: T.paper,
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: T.sub,
                    }}
                  >
                    書き出す(v0.2)
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: `1.5px solid ${T.line}`,
  background: T.bg,
  color: T.ink,
  fontSize: 12.5,
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
  onSave: (patch: { title: string; star: Star; learn: string }) => void;
}) {
  const [title, setTitle] = useState(episode.title);
  const [star, setStar] = useState<Star>(episode.star);
  const [learn, setLearn] = useState(episode.learn);

  return (
    <div className="sc-fade" style={{ padding: "0 15px 13px" }}>
      <label style={{ display: "block", fontSize: 10, color: T.sub, marginBottom: 4 }}>
        タイトル
      </label>
      <input value={title} onChange={(ev) => setTitle(ev.target.value)} style={fieldStyle} />

      {STAR_LABELS.map(({ key, label }) => (
        <div key={key} style={{ marginTop: 10 }}>
          <label style={{ display: "block", fontSize: 10, color: T.sub, marginBottom: 4 }}>
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
        <label style={{ display: "block", fontSize: 10, color: T.sub, marginBottom: 4 }}>
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
          onClick={() => onSave({ title, star, learn })}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 9,
            border: "none",
            background: T.primary,
            color: "#fff",
            fontSize: 11.5,
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
            fontSize: 11.5,
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
