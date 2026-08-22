/**
 * Design tokens — Socius Career
 * 墨色のインク + 深い青緑(伴走者=socius) + 金茶(自分の言葉=資産)
 *
 * These used to be hex literals. They are references to the CSS variables in
 * globals.css now, so that the settings screen's light/dark switch is one
 * attribute on <html> rather than a prop threaded through every component that
 * draws anything. Inline styles resolve var() the same as a stylesheet does.
 *
 * The consequence to remember: a token is no longer a colour you can do string
 * arithmetic on. `${T.primary}33` used to mean "primary at 20% alpha" and now
 * means nothing at all. Use a dedicated token, or color-mix().
 *
 * globals.css `:root` holds the values; this file holds the names.
 */
export const T = {
  bg: "var(--sc-bg)",
  paper: "var(--sc-paper)",
  ink: "var(--sc-ink)",
  sub: "var(--sc-sub)",
  line: "var(--sc-line)",
  primary: "var(--sc-primary)",
  primarySoft: "var(--sc-primary-soft)",
  gold: "var(--sc-gold)",
  goldSoft: "var(--sc-gold-soft)",
  /** Text on a goldSoft field. Was the literal #8a6420 in six places. */
  goldInk: "var(--sc-gold-ink)",
  karakuchi: "var(--sc-karakuchi)",
  karakuchiSoft: "var(--sc-karakuchi-soft)",
  /**
   * Text on a filled primary or karakuchi button.
   *
   * Not white. In dark mode the accents come up several steps to stay legible
   * against the ink, and white on top of a lightened teal is worse than the
   * background it sits on.
   */
  onAccent: "var(--sc-on-accent)",
  /** Behind drawers and dialogs. Darker in dark mode, not lighter. */
  scrim: "var(--sc-scrim)",
  /** Raised surfaces — toasts, menus, the dialog. */
  shadow: "var(--sc-shadow)",
} as const;

export type ThemeToken = keyof typeof T;

/**
 * A font size that follows the 文字サイズ setting.
 *
 * Every size in this app is an inline px number, which is the one form that
 * cannot be scaled from a stylesheet — px does not inherit, and there is no
 * ancestor rule that reaches it. Passing them through here makes each one a
 * calc() against a single variable instead, so 小/標準/大 is one property on
 * <html>.
 *
 *   fontSize: 12.5   →   fontSize: fs(12.5)
 */
export function fs(px: number): string {
  return `calc(${px}px * var(--sc-font-scale, 1))`;
}

/**
 * The smallest text iOS will leave alone.
 *
 * Safari zooms the page when a field with text under 16px takes focus, and it
 * does not zoom back out afterwards. What the student sees is the app jumping
 * a step larger the moment they tap the box, then staying there — the 「入力時
 * に勝手に拡大される」 report (β, 8/18). There is no way to switch that off
 * that is not also switching off pinch-to-zoom, which is a real accessibility
 * control and not ours to take.
 *
 * So the fields meet the threshold instead.
 */
const NO_ZOOM_PX = 16;

/**
 * A font size for something the student types into.
 *
 * A floor rather than a fixed 16, so 「大」 still enlarges the box it is typed
 * in — the setting means the whole app, and a field that ignored it would be
 * the one place the student's own words stayed small. 「小」 stops at the
 * threshold, because below it the size is not a preference any more, it is a
 * zoom the browser performs on their behalf.
 *
 * Every `<input>`, `<textarea>` and `<select>` carrying text uses this rather
 * than fs(). Checkboxes do not — there is no text in them to zoom towards.
 */
export function fieldFs(px: number): string {
  return `max(${NO_ZOOM_PX}px, ${fs(px)})`;
}
