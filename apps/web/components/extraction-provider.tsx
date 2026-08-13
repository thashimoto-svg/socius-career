"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Toast, TOAST_MS, type ToastTone } from "@/components/toast";
import { useAuth } from "@/lib/firebase/auth-context";
import { extractEpisode, isExtractionAbandoned } from "@/lib/extraction";
import type { Message, Session } from "@/lib/firebase/schema";

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

export function ExtractionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [toast, setToast] = useState<{ id: number; text: string; tone: ToastTone } | null>(
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
      // Being deleted. Leaving a 壁打ち is what triggers extraction, and
      // deleting the open one leaves it — so this is not a rare race, it is the
      // ordinary path through the delete button.
      if (isExtractionAbandoned(job.session.id)) return;
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
        <Toast key={toast.id} tone={toast.tone}>
          {toast.text}
        </Toast>
      )}
    </ExtractionContext.Provider>
  );
}
