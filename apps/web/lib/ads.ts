/**
 * The advertising slot's settings, kept apart from what it draws.
 *
 * There is no advertising yet. What there is, is the decision about where it
 * would go — which is the part that is expensive to change later, because it is
 * spread across the screens rather than contained in a component. Putting the
 * slots in now, with a house notice inside them, means the day a network is
 * added is a change to one file rather than a change to the shape of every
 * screen a student reads.
 *
 * It also means the placement can be judged before it is sold. A slot every ten
 * messages either does or does not break the thread of a 壁打ち, and that is
 * answerable now, at no cost, by looking at it.
 */

/**
 * `placeholder` — draw the house notice. `off` — draw nothing at all.
 *
 * Read as a whole static expression because that is the only form Next inlines
 * at build time; `process.env[name]` or a destructured copy reaches the browser
 * as undefined. Which also means changing it needs a rebuild, not a restart.
 *
 * Unset means `placeholder`. The slots are meant to be visible during the beta
 * — that is what they are for — and a default of `off` would make an
 * unconfigured deployment quietly ship a feature nobody could see.
 */
export type AdsMode = "placeholder" | "off";

export const ADS_MODE: AdsMode =
  process.env.NEXT_PUBLIC_ADS_MODE === "off" ? "off" : "placeholder";

export const adsEnabled = ADS_MODE !== "off";

/**
 * How many messages between slots in a 壁打ち.
 *
 * Ten is roughly five exchanges — long enough that a slot never lands inside
 * the back-and-forth of a single question, which is the moment a student is
 * least able to afford an interruption.
 */
export const AD_INTERVAL = 10;

/**
 * Whether a slot belongs after the message at `index` (0-based).
 *
 * Never after the last message: a slot there is not "between messages", it is a
 * card sitting under the line the AI just wrote, in the space the student is
 * about to reply into.
 */
export function adSlotFollows(index: number, total: number): boolean {
  if (!adsEnabled) return false;
  if (index >= total - 1) return false;
  return (index + 1) % AD_INTERVAL === 0;
}
