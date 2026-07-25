/**
 * Design tokens — Socius Career
 * 墨色のインク + 深い青緑(伴走者=socius) + 金茶(自分の言葉=資産)
 *
 * These are the source of truth for the app's colors. They are consumed both
 * as inline styles in components and mirrored as CSS variables in globals.css
 * (see `:root`) so the two never drift.
 */
export const T = {
  bg: "#F4F6F5",
  paper: "#FFFFFF",
  ink: "#22302F",
  sub: "#6C7A78",
  line: "#E2E8E6",
  primary: "#175E63",
  primarySoft: "#E4EFEE",
  gold: "#C8963E",
  goldSoft: "#F8F1E3",
  karakuchi: "#8A3B2E",
  karakuchiSoft: "#F7EAE6",
} as const;

export type ThemeToken = keyof typeof T;
