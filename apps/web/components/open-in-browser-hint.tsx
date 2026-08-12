"use client";

import { useEffect, useState } from "react";
import { inAppBrowserName, isInAppBrowser } from "@/lib/in-app-browser";
import { fs, T } from "@/lib/theme";

/**
 * The way out, for the sign-in that cannot be fixed from inside the page.
 *
 * Detection picks the redirect flow for a WebView, and redirect works in most
 * of them. Most is not all: an embedded browser with third-party storage
 * switched off has nowhere for Firebase Auth to keep a session, and no flow we
 * can choose changes that. What fixes it is being in Safari or Chrome instead —
 * which the student can do, and would never think to, because from where they
 * are sitting they are already "in a browser".
 *
 * So it is one small line and one button. Not an error — it is shown before
 * anything has gone wrong, because the student who needs it is the one whose
 * sign-in is about to silently do nothing, and a hint that only appears after
 * the failure is a hint they will not still be here to read.
 *
 * Small on purpose. Everyone sees it; almost nobody needs it.
 */
export function OpenInBrowserHint() {
  // Read after mount, never during render: the server has no navigator, and a
  // component that renders one thing on the server and another in the browser
  // is a hydration mismatch. It also means the first paint is the quiet
  // version, which is the correct one for most students.
  const [appName, setAppName] = useState<string | null>(null);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    if (isInAppBrowser()) setAppName(inAppBrowserName());
  }, []);

  useEffect(() => {
    if (copied === "idle") return;
    const t = setTimeout(() => setCopied("idle"), 2400);
    return () => clearTimeout(t);
  }, [copied]);

  const copyLink = async () => {
    const url = window.location.href;

    // The modern API needs a secure context and a permission the embedded
    // browsers are the least likely to grant, so its absence is expected rather
    // than exceptional.
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        setCopied("done");
        return;
      }
    } catch {
      // Fall through to the old way.
    }

    // execCommand is deprecated and is the only thing that works here. The
    // textarea has to be in the document and focusable to be selected, and off
    // screen so that selecting it does not scroll the page.
    try {
      const scratch = document.createElement("textarea");
      scratch.value = url;
      scratch.setAttribute("readonly", "");
      scratch.style.position = "fixed";
      scratch.style.top = "-1000px";
      scratch.style.opacity = "0";
      document.body.appendChild(scratch);
      scratch.select();
      scratch.setSelectionRange(0, url.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(scratch);
      setCopied(ok ? "done" : "failed");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <div
      style={{
        marginTop: 16,
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${T.line}`,
        // Named, it is advice the student should act on now; unnamed, it is a
        // footnote for the few who need it. Same words, different weight.
        background: appName ? T.goldSoft : "transparent",
      }}
    >
      <div
        style={{
          fontSize: fs(10.5),
          color: appName ? T.goldInk : T.sub,
          lineHeight: 1.8,
        }}
      >
        {appName ? (
          <>
            {appName}
            内のブラウザで開いています。うまくログインできない場合は、Safari /
            Chrome で開いてからお試しください。
          </>
        ) : (
          <>うまくログインできない場合は、Safari / Chrome で開いてください。</>
        )}
      </div>

      <button
        type="button"
        onClick={() => void copyLink()}
        style={{
          marginTop: 8,
          padding: "6px 14px",
          borderRadius: 999,
          border: `1px solid ${appName ? T.goldInk : T.line}`,
          background: T.paper,
          color: appName ? T.goldInk : T.sub,
          fontSize: fs(10.5),
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {copied === "done"
          ? "コピーしました"
          : copied === "failed"
            ? "コピーできませんでした"
            : "リンクをコピー"}
      </button>

      {/* The last resort behind the last resort: if the clipboard is refused
          too, the address is at least on screen to be read or long-pressed. */}
      {copied === "failed" && (
        <div
          style={{
            marginTop: 6,
            fontSize: fs(10),
            color: T.sub,
            lineHeight: 1.6,
            overflowWrap: "anywhere",
            userSelect: "all",
          }}
        >
          {typeof window === "undefined" ? "" : window.location.href}
        </div>
      )}
    </div>
  );
}
