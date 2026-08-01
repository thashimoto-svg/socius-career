"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { extractEpisode } from "@/lib/extraction";
import type { Message, Session } from "@/lib/firebase/schema";
import { T } from "@/lib/theme";

/**
 * Where automatic extraction actually runs.
 *
 * It lives above the pages, in the (main) layout, for one reason: the moment a
 * 壁打ち is most obviously finished with is the moment the student leaves it,
 * and a job started inside the chat screen would be started by a component that
 * is about to unmount. The fetch itself would survive that, but nothing would
 * be left to tell them it worked.
 */

export type ExtractionJob = {
  session: Session;
  messages: Message[];
  /**
   * Told how far the transcript has now been read, so the screen that asked
   * can keep its own copy of the session in step and not ask again for the
   * same lines.
   */
  onRead?: (extractedCount: number) => void;
};

type StartExtraction = (job: ExtractionJob) => void;

const ExtractionContext = createContext<StartExtraction>(() => {});

export function useExtraction(): StartExtraction {
  return useContext(ExtractionContext);
}

/** How long a toast stays before it goes away on its own. */
const TOAST_MS = 4200;

export function ExtractionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [toast, setToast] = useState<{ id: number; text: string; tone: "ok" | "warn" } | null>(
    null,
  );
  // One run per 壁打ち at a time. Two triggers can land together — leaving a
  // conversation to start a new one fires both — and without this the second
  // would read a transcript the first has not finished writing the result of.
  const running = useRef(new Set<string>());

  const start = useCallback<StartExtraction>(
    (job) => {
      if (!user) return;
      if (running.current.has(job.session.id)) return;
      running.current.add(job.session.id);

      const read = job.messages.length;

      void extractEpisode(user, job.session, job.messages)
        .then((outcome) => {
          if (outcome.kind === "created" || outcome.kind === "updated") {
            job.onRead?.(read);
            setToast({
              id: Date.now(),
              tone: "ok",
              text:
                outcome.kind === "created"
                  ? `「${outcome.title}」を自分史に追加しました`
                  : `「${outcome.title}」を自分史で更新しました`,
            });
            return;
          }

          if (outcome.kind === "nothing") {
            // Silent on purpose. Most runs land here, and a student who is told
            // 「まだ残せるものはありません」 every time they switch threads would
            // read it as the feature being broken.
            job.onRead?.(read);
            return;
          }

          setToast({
            id: Date.now(),
            tone: "warn",
            text: "自分史への保存に失敗しました。次に開いたときにもう一度試します。",
          });
        })
        .finally(() => {
          running.current.delete(job.session.id);
        });
    },
    [user],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ExtractionContext.Provider value={start}>
      {children}
      {toast && (
        <div
          // Announced rather than shown only: the student is usually looking at
          // the conversation they just moved to, not at the bottom of the screen.
          role="status"
          aria-live="polite"
          className="sc-fade"
          key={toast.id}
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 66px)",
            zIndex: 60,
            maxWidth: "min(432px, calc(100% - 32px))",
            padding: "10px 16px",
            borderRadius: 12,
            background: toast.tone === "ok" ? T.goldSoft : T.karakuchiSoft,
            border: `1.5px solid ${toast.tone === "ok" ? T.gold : T.karakuchi}`,
            color: toast.tone === "ok" ? "#8a6420" : T.karakuchi,
            fontSize: 11.5,
            fontWeight: 700,
            lineHeight: 1.7,
            boxShadow: "0 6px 20px rgba(34, 48, 47, 0.14)",
          }}
        >
          {toast.text}
        </div>
      )}
    </ExtractionContext.Provider>
  );
}
