"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import { AuthSplash } from "@/components/auth-splash";
import { T } from "@/lib/theme";

export default function LoginPage() {
  const { user, loading, error, signInWithGoogle } = useAuth();
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);

  // Someone who is already signed in has no business on this screen; "/" owns
  // the onboarding-vs-chat decision, so bounce there rather than guessing.
  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  if (loading || user) return <AuthSplash />;

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
          style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}
        >
          Socius Career
        </div>
        <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.9 }}>
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
          fontSize: 12,
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
        onClick={() => signInWithGoogle(agreed)}
        disabled={!agreed}
        style={{
          padding: "13px 0",
          borderRadius: 12,
          border: "none",
          background: agreed ? T.primary : T.line,
          color: agreed ? "#fff" : T.sub,
          fontSize: 14,
          fontWeight: 700,
          cursor: agreed ? "pointer" : "not-allowed",
        }}
      >
        Google で続ける
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
            fontSize: 12,
            lineHeight: 1.7,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          marginTop: 20,
          fontSize: 11,
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
