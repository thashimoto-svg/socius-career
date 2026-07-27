"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Chip } from "@/components/Chip";
import { useAuth } from "@/lib/firebase/auth-context";
import { saveOnboarding } from "@/lib/firebase/users";
import { T } from "@/lib/theme";

type Step = {
  q: string;
  sub?: string;
  render: () => React.ReactNode;
};

// 7/20 MTG: 学部6年制の学科と院生が選べないままだと、対象外だと受け取られる。
// 数が増えてチップは2〜3行に折り返すが、自分の学年が無い方が問題という判断。
const GRADES = [
  "大学1年",
  "大学2年",
  "大学3年",
  "大学4年",
  "大学5年(理系)",
  "大学6年(理系)",
  "修士1年",
  "修士2年",
];
const CLUBS = ["体育会系の部活", "サークル", "アルバイト", "研究・ゼミ", "特に思いつかない"];
const INDUSTRIES = ["メーカー", "IT", "金融", "教育", "公務員", "まだ決まっていない"];
const UNDECIDED = "まだ決まっていない";

export default function OnboardingPage() {
  const router = useRouter();
  const { user, userDoc, applyOnboarding } = useAuth();
  const [step, setStep] = useState(0);
  // Prefilled from a previous run, so revisiting this screen to change an
  // answer shows what the student picked last time rather than the defaults.
  const saved = userDoc?.profile;
  const [grade, setGrade] = useState(saved?.grade ?? "大学3年");
  const [club, setClub] = useState(saved?.club ?? "体育会系の部活");
  const [inds, setInds] = useState<string[]>(saved?.industries ?? [UNDECIDED]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const toggleInd = (v: string) =>
    setInds((s) => {
      // "まだ決まっていない" is exclusive with the concrete choices.
      if (v === UNDECIDED) return [UNDECIDED];
      const next = s.filter((x) => x !== UNDECIDED);
      return next.includes(v) ? next.filter((x) => x !== v) : [...next, v];
    });

  const steps: Step[] = useMemo(
    () => [
      {
        q: "いま、どの学年ですか?",
        render: () =>
          GRADES.map((v) => (
            <Chip key={v} label={v} active={grade === v} onClick={() => setGrade(v)} />
          )),
      },
      {
        q: "打ち込んできたことに近いのは?",
        sub: "壁打ちの最初の話題づくりに使います",
        render: () =>
          CLUBS.map((v) => (
            <Chip key={v} label={v} active={club === v} onClick={() => setClub(v)} />
          )),
      },
      {
        q: "気になっている業界はありますか?",
        sub: "複数選択OK。「まだ決まっていない」も立派な現在地です",
        render: () =>
          INDUSTRIES.map((v) => (
            <Chip key={v} label={v} active={inds.includes(v)} onClick={() => toggleInd(v)} />
          )),
      },
    ],
    [grade, club, inds],
  );

  const done = step >= steps.length;

  // The answers are what the 壁打ち opens with, so they have to be stored before
  // the student lands on /chat — otherwise the first question arrives with no
  // context and the 「プロンプトを考える必要はありません」 promise breaks.
  const advance = async () => {
    if (!done) {
      setStep((s) => Math.min(s + 1, steps.length));
      return;
    }
    if (!user || saving) return;

    setSaving(true);
    setSaveError(null);
    try {
      const profile = { grade, club, industries: inds };
      await saveOnboarding(user.uid, profile);
      applyOnboarding(profile);
      router.replace("/chat");
    } catch {
      setSaveError("保存できませんでした。通信状況を確認して、もう一度お試しください。");
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: "22px 18px", flex: 1, display: "flex", flexDirection: "column" }}>
      {/* progress */}
      <div style={{ display: "flex", gap: 5, marginBottom: 26 }}>
        {steps.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: i <= step ? T.primary : T.line,
            }}
          />
        ))}
      </div>

      {!done ? (
        <div className="sc-fade" key={step} style={{ flex: 1 }}>
          <div className="sc-display" style={{ fontSize: 19, fontWeight: 700, marginBottom: 6 }}>
            {steps[step].q}
          </div>
          {steps[step].sub && (
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 14 }}>{steps[step].sub}</div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            {steps[step].render()}
          </div>
        </div>
      ) : (
        <div
          className="sc-fade"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            textAlign: "center",
          }}
        >
          <div className="sc-display" style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>
            準備ができました
          </div>
          <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.8 }}>
            {grade}・{club}の経験から、
            <br />
            最初の壁打ちを始めましょう。
            <br />
            <span style={{ color: T.gold, fontWeight: 700 }}>
              プロンプトを考える必要はありません。
            </span>
          </div>
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 10,
            background: T.karakuchiSoft,
            color: T.karakuchi,
            fontSize: 12,
            lineHeight: 1.7,
          }}
        >
          {saveError}
        </div>
      )}

      <button
        type="button"
        onClick={advance}
        disabled={saving}
        style={{
          marginTop: 16,
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: T.primary,
          color: "#fff",
          fontSize: 14,
          fontWeight: 700,
          opacity: saving ? 0.6 : 1,
          cursor: saving ? "default" : "pointer",
        }}
      >
        {done ? (saving ? "保存しています…" : "壁打ちを始める") : "次へ"}
      </button>
      {step > 0 && !done && (
        <button
          type="button"
          onClick={() => setStep((s) => s - 1)}
          style={{
            marginTop: 8,
            background: "none",
            border: "none",
            color: T.sub,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          もどる
        </button>
      )}
    </div>
  );
}
