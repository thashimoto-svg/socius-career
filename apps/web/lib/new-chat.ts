import { defaultTheme } from "@socius/prompts";
import { createSession } from "./firebase/sessions";
import type { ChatMode, OnboardingProfile } from "./firebase/schema";
import { LOAD_TIMEOUT_MS, withTimeout } from "./with-timeout";

/**
 * Start a 壁打ち, from wherever the student pressed the button.
 *
 * There are two of those buttons now — ＋ in the header, on every screen, and
 * the tone menu, which starts a new conversation as the only way to change
 * style — and they should produce identical sessions. Shared so that stays
 * true without either caller having to remember the placeholder title or where
 * 「今日のテーマ」 comes from.
 *
 * The session is created before navigating, not after, so the drawer's list has
 * something real to show rather than a thread that exists only as a pending URL.
 */
export async function startChat(
  uid: string,
  opts: { mode: ChatMode; profile: OnboardingProfile | null },
): Promise<string> {
  // Bounded, because both callers disable their button while this runs and the
  // id is what they navigate with. A write that is never acknowledged would
  // leave 「準備しています…」 on screen with nothing coming.
  const created = await withTimeout(
    createSession(uid, {
      // 「新しい壁打ち」 is a placeholder the student's first message replaces.
      title: "新しい壁打ち",
      theme: defaultTheme(opts.profile),
      mode: opts.mode,
    }),
    LOAD_TIMEOUT_MS,
    "新しい壁打ちを始められませんでした。",
  );
  return created.id;
}
