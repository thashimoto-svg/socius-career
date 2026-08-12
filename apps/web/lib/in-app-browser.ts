/**
 * Is this page running inside another app's embedded browser?
 *
 * It matters because of one thing only: `signInWithPopup` cannot work in most
 * of them. A WebView either has no window opener at all, or opens the popup in
 * a context that can never post its result back to the page that asked — so the
 * student taps 「Google で続ける」, something flashes, and nothing happens. There
 * is no error to show them, because from the SDK's point of view nothing failed
 * yet; it is still waiting for a window that will never answer.
 *
 * Students reach this app from LINE and Instagram, which is to say most of them
 * arrive inside one of these. So the detection is deliberately eager: guessing
 * "in-app" when it is really Chrome costs a redirect the student would not have
 * noticed, and guessing "real browser" when it is really LINE costs the sign-in
 * entirely.
 *
 * User-Agent sniffing is the wrong tool for almost everything and the only tool
 * for this. There is no capability to feature-detect — `window.open` exists in a
 * WebView and returns something; it simply never comes back.
 */

/**
 * Vendor tokens, lowercased. Each is a substring that only appears in the
 * User-Agent of an app's embedded browser and not in that app's real one.
 */
const IN_APP_TOKENS = [
  // The two that matter most for this app.
  "line/", // LINE — iOS appends `Line/13.x`, Android `Line/13.x/IAB`.
  "instagram",

  // Meta's other surfaces, which share Instagram's WebView.
  "fbav", // Facebook app version
  "fban", // Facebook app name
  "fb_iab", // Facebook in-app browser
  "fbios",

  "twitter", // X
  "tiktok",
  "musical_ly", // TikTok's older token
  "kakaotalk",
  "micromessenger", // WeChat
  "snapchat",
  "pinterest",
] as const;

/**
 * `; wv` is Android's own marker: Chrome stamps it into the UA of any WebView
 * built on it, whichever app is hosting. It catches the apps not named above.
 */
const ANDROID_WEBVIEW = /;\s*wv[;)]/;

/**
 * iOS has no equivalent stamp, so it is read by absence.
 *
 * Every iOS browser is WebKit, and Safari — plus Chrome, Firefox and Edge on
 * iOS, which are Safari wearing a hat — puts a `Safari/` token at the end of
 * the UA. A WKWebView embedded in an app does not. So "mobile WebKit with no
 * Safari token" is an app's browser.
 *
 * Guarded on `Mobile/` so this cannot fire for a desktop UA, and checked after
 * the vendor tokens so the apps that *do* keep the Safari token (LINE on iOS is
 * one) are already caught by name.
 */
const IOS_WEBKIT = /\b(iPhone|iPad|iPod)\b/i;

export function isInAppBrowser(userAgent?: string | null): boolean {
  const ua =
    userAgent ??
    (typeof navigator === "undefined" ? "" : navigator.userAgent);
  if (!ua) return false;

  const lower = ua.toLowerCase();
  if (IN_APP_TOKENS.some((token) => lower.includes(token))) return true;
  if (ANDROID_WEBVIEW.test(ua)) return true;

  // iOS by absence — see IOS_WEBKIT above.
  if (IOS_WEBKIT.test(ua) && /applewebkit/i.test(ua) && !/safari\//i.test(ua)) {
    return true;
  }

  return false;
}

/**
 * Which app, for the one sentence on the login screen that names it.
 *
 * Only the two the students actually arrive from are worth naming; anything
 * else gets the generic 「アプリ内ブラウザ」, which is still true and still tells
 * them what to do about it.
 */
export function inAppBrowserName(userAgent?: string | null): string | null {
  const ua =
    userAgent ??
    (typeof navigator === "undefined" ? "" : navigator.userAgent);
  if (!ua) return null;

  const lower = ua.toLowerCase();
  if (lower.includes("line/")) return "LINE";
  if (lower.includes("instagram")) return "Instagram";
  if (!isInAppBrowser(ua)) return null;
  return "アプリ内ブラウザ";
}
