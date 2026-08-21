"use client";

import { useEffect, useState } from "react";

/**
 * A CSS media query, as a boolean React can read.
 *
 * There are two of these in the app and they ask about different things. The
 * sidebar asks about width, because its layout is the stylesheet's decision and
 * it only wants to know whether to bother fetching. The composer asks about the
 * *input device*, because 「Enterで送信」 is a keyboard convention and a phone
 * has no Enter key to spare — it has a 改行 key that the browser reports as
 * one.
 *
 * Always starts false and corrects after mount. The server has no viewport and
 * no pointer, so any other starting value is a guess that hydration has to
 * undo — which on the sidebar would be the whole page shifting sideways, and in
 * the composer would be the first keystroke behaving one way and the second
 * another.
 */
export function useMediaQuery(queryString: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(queryString);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [queryString]);

  return matches;
}

/**
 * Whether the student is typing on a real keyboard.
 *
 * Not a width test. A phone in landscape is wide and still has no Enter key of
 * its own to spend on 送信; a small window on a laptop is narrow and does. What
 * separates them is the pointer — 「fine」 means a mouse or a trackpad, which in
 * practice comes with the keyboard that makes Enter=送信 worth having.
 */
export const PHYSICAL_KEYBOARD_QUERY = "(hover: hover) and (pointer: fine)";
