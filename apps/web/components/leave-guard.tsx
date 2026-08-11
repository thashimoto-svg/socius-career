"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

/**
 * "I am about to be navigated away from."
 *
 * On phones, leaving a 壁打ち only ever happened through a control the chat
 * screen itself rendered — the drawer and ＋ live in AppHeader, which takes an
 * `onBeforeLeave` prop, so the screen could hand its transcript to the
 * extractor on the way out. The desktop sidebar breaks that: it lives in the
 * layout, above every screen, and knows nothing about the conversation it is
 * navigating away from.
 *
 * Without this, switching sessions from the sidebar would quietly skip the
 * extraction handoff — the 壁打ち would still be there, but nothing new from it
 * would ever reach the 自分史, and no screen would say so. The sidebar is
 * supposed to be the drawer's replacement at this width, so it has to do what
 * the drawer did.
 *
 * One callback, not a list. Exactly one screen is mounted at a time, and it is
 * the one being left.
 */

type LeaveGuardValue = {
  /**
   * Register what to run before this screen is left. Returns the unregister,
   * so it can be the whole body of an effect.
   */
  registerBeforeLeave: (fn: () => void) => () => void;
  /** Called by anything in the shell that is about to navigate. */
  runBeforeLeave: () => void;
};

const LeaveGuardContext = createContext<LeaveGuardValue | null>(null);

export function LeaveGuardProvider({ children }: { children: React.ReactNode }) {
  const current = useRef<(() => void) | null>(null);

  const registerBeforeLeave = useCallback((fn: () => void) => {
    current.current = fn;
    return () => {
      // Only if it is still ours. Screens unmount after their replacement has
      // mounted and registered, and a blind clear on the way out would erase
      // the incoming screen's callback instead of our own.
      if (current.current === fn) current.current = null;
    };
  }, []);

  const runBeforeLeave = useCallback(() => {
    current.current?.();
  }, []);

  const value = useMemo(
    () => ({ registerBeforeLeave, runBeforeLeave }),
    [registerBeforeLeave, runBeforeLeave],
  );

  return (
    <LeaveGuardContext.Provider value={value}>{children}</LeaveGuardContext.Provider>
  );
}

export function useLeaveGuard(): LeaveGuardValue {
  const ctx = useContext(LeaveGuardContext);
  if (!ctx) throw new Error("useLeaveGuard must be used inside <LeaveGuardProvider>");
  return ctx;
}

/**
 * The screen side of it. `fn` is expected to be a useCallback — an inline
 * function would re-register on every render, which is harmless but pointless.
 */
export function useBeforeLeave(fn: () => void): void {
  const { registerBeforeLeave } = useLeaveGuard();
  useEffect(() => registerBeforeLeave(fn), [registerBeforeLeave, fn]);
}
