"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mark } from "./perf";
import { LOAD_TIMEOUT_MS, withTimeout } from "./with-timeout";

/**
 * The one way a screen loads the data it needs.
 *
 * Every screen in this app reads one student's documents and can show nothing
 * until they arrive, and every one of them used to write that out by hand: a
 * `useState(null)`, an effect, a `.catch(() => setError(true))`. That shape has
 * a failure mode nobody wrote a branch for — the Firestore SDK treats an
 * unreachable backend as something to keep retrying rather than something to
 * fail, so the promise never settles, the catch never runs, and the screen sits
 * on 「読み込んでいます…」 forever. A catch cannot fix that. Only a deadline can.
 *
 * So the deadline lives here, once, instead of in the one screen that happened
 * to have the bug reported against it. Three states, and every screen gets all
 * three whether or not its author thought about the third:
 *
 *   loading → data
 *   loading → error, with a way to try again
 *
 * Loaders take the uid because that is what every one of them needs: nothing in
 * this app reads anything that is not a document belonging to the signed-in
 * student. `uid` of null means there is nobody to load for yet, which is not an
 * error and not a wait — it is simply nothing.
 */

export type Loadable<T> = {
  /** The loaded value, or null while loading and after a failure. */
  data: T | null;
  /** What to show the student. Null when there is nothing wrong. */
  error: string | null;
  /** True while a load is in flight and there is nothing on screen yet. */
  loading: boolean;
  /** Run it again. What the 再試行 button calls. */
  retry: () => void;
};

export function useLoadable<T>(
  uid: string | null,
  load: (uid: string) => Promise<T>,
  opts: {
    /** Shown to the student on both a timeout and an outright failure. */
    message: string;
    /**
     * Distinguishes two loads for the same student on the same screen — the
     * 壁打ち a link pointed at, versus whichever one is most recent. Changing it
     * starts a new load; leaving it out means the uid is the whole identity.
     */
    scope?: string;
    timeoutMs?: number;
  },
): Loadable<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({
    data: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  // The loader is usually written inline at the call site, so it is a new
  // function on every render and cannot be an effect dependency. The key is
  // what decides when to run; this is just how the effect reaches it.
  const loadRef = useRef(load);
  const optsRef = useRef(opts);
  useEffect(() => {
    loadRef.current = load;
    optsRef.current = opts;
  });

  const key = uid === null ? null : `${uid}:${opts.scope ?? ""}#${attempt}`;

  // Development mounts every component twice, and the second mount must not
  // repeat work the first one already started — opening a 壁打ち can create a
  // session. One request per key, shared between the two runs.
  const inflight = useRef<{ key: string; promise: Promise<T> } | null>(null);

  useEffect(() => {
    if (uid === null || key === null) return;

    // Loading someone else's data, or the same data again: whatever is on
    // screen belongs to the previous key and is not an answer to this one.
    setState({ data: null, error: null });

    const scope = optsRef.current.scope ?? "";

    if (inflight.current?.key !== key) {
      // Deliberately marked here rather than at the top of the effect: this is
      // the moment the screen's own network work starts, and the gap between it
      // and gate:開通 above is the waterfall — two round trips that could have
      // been one.
      mark(`screen:${scope} 取得開始`);
      inflight.current = {
        key,
        promise: withTimeout(
          loadRef.current(uid),
          optsRef.current.timeoutMs ?? LOAD_TIMEOUT_MS,
          optsRef.current.message,
        ),
      };
    }

    let cancelled = false;

    inflight.current.promise.then(
      (value) => {
        mark(`screen:${scope} 取得完了`);
        if (!cancelled) setState({ data: value, error: null });
      },
      (e) => {
        if (cancelled) return;
        // The student gets one sentence they can act on; whoever is debugging
        // gets the rule rejection or the index error that actually happened.
        console.error(`[load] ${key}`, e);
        setState({ data: null, error: optsRef.current.message });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [uid, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    data: state.data,
    error: state.error,
    loading: uid !== null && state.data === null && state.error === null,
    retry,
  };
}
