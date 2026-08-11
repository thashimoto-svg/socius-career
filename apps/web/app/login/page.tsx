"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import { AuthSplash } from "@/components/auth-splash";
import { OpenInBrowserHint } from "@/components/open-in-browser-hint";
import { fs, T } from "@/lib/theme";

export default function LoginPage() {
  const { user, sessionLoading, error, signInWithGoogle } = useAuth();
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  // The redirect flow navigates the whole document away, and the browser takes
  // a moment to do it. Without this the screen sits there looking untouched
  // after the tap, which reads as a button that did nothing — the exact
  // impression this whole change exists to remove.
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signInWithGoogle(agreed);
    } finally {
      // Matters on the popup path and on a redirect that failed to start —
      // both leave the student on this screen with a button that has to work
      // again. On a redirect that did start, the document is already unloading
      // and whatever this sets is about to stop existing.
      setBusy(false);
    }
  };

  // Someone who is already signed in has no business on this screen; "/" owns
  // the onboarding-vs-chat decision, so bounce there rather than guessing.
  //
  // The session is the whole question here. Whether their profile has loaded
  // is not this screen's business — it used to wait for it anyway, which meant
  // the first screen of the app held itself back for a document that belongs to
  // someone who, on this screen, is usually not signed in at all.
  useEffect(() => {
    if (!sessionLoading && user) router.replace("/");
  }, [sessionLoading, user, router]);

  if (sessionLoading || user) return <AuthSplash />;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 24px 40px",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div
          className="sc-display"
          style={{ fontSize: fs(24), fontWeight: 700, marginBottom: 12 }}
        >
          Socius Career
        </div>
        <div style={{ fontSize: fs(13), color: T.sub, lineHeight: 1.9 }}>
          就活生のための、対話型の自己分析。
          <br />
          <span style={{ color: T.gold, fontWeight: 700 }}>あなたの言葉で</span>
          、自分史をつくる。
        </div>
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 9,
          marginBottom: 14,
          fontSize: fs(12),
          color: T.ink,
          lineHeight: 1.7,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          style={{
            width: 17,
            height: 17,
            marginTop: 1,
            accentColor: T.primary,
            flexShrink: 0,
            cursor: "pointer",
          }}
        />
        <span>
          <Link
            href="/privacy"
            style={{ color: T.primary, fontWeight: 700, textDecoration: "underline" }}
          >
            プライバシーポリシー
          </Link>
          と
          <Link
            href="/terms"
            style={{ color: T.primary, fontWeight: 700, textDecoration: "underline" }}
          >
            利用規約
          </Link>
          に同意する
        </span>
      </label>

      <button
        type="button"
        onClick={() => void signIn()}
        disabled={!agreed || busy}
        style={{
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: agreed ? T.primary : T.line,
          color: agreed ? T.onAccent : T.sub,
          fontSize: fs(14),
          fontWeight: 700,
          opacity: busy ? 0.6 : 1,
          cursor: agreed && !busy ? "pointer" : "not-allowed",
        }}
      >
        {busy ? "サインインしています…" : "Google で続ける"}
      </button>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 10,
            background: T.karakuchiSoft,
            color: T.karakuchi,
            fontSize: fs(12),
            lineHeight: 1.7,
            // The configuration errors are two or three lines and carry a
            // hostname that has to be readable to be pasted, so the newlines
            // they are written with have to survive, and a domain longer than
            // the panel has to wrap rather than push it sideways.
            whiteSpace: "pre-line",
            overflowWrap: "anywhere",
          }}
        >
          {error}
        </div>
      )}

      <OpenInBrowserHint />

      <div
        style={{
          marginTop: 20,
          fontSize: fs(11),
          color: T.sub,
          lineHeight: 1.8,
          textAlign: "center",
        }}
      >
        書いた内容はあなただけのものです。
        <br />
        本人以外は読めません。
      </div>
    </div>
  );
}
