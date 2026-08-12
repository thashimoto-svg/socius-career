import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb } from "./client";

/**
 * The student's app settings, at users/{uid}/settings/app.
 *
 * A subcollection with one fixed document rather than fields on the user doc:
 * the user document is identity and onboarding answers, written on sign-in and
 * read by the 壁打ち prompt, and appearance preferences have no business
 * invalidating that read or sharing its rules.
 */

export type FontSize = "small" | "normal" | "large";
export type ThemeChoice = "light" | "dark" | "system";
/** English is not translated yet. The setting exists so it can be. */
export type Language = "ja";

export type AppSettings = {
  fontSize: FontSize;
  theme: ThemeChoice;
  language: Language;
};

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: "normal",
  theme: "system",
  language: "ja",
};

/** How much bigger or smaller 小 / 標準 / 大 actually are. */
export const FONT_SCALE: Record<FontSize, number> = {
  small: 0.9,
  normal: 1,
  large: 1.18,
};

const SETTINGS_DOC = "app";

function settingsRef(uid: string) {
  return doc(getDb(), "users", uid, "settings", SETTINGS_DOC);
}

function parse(data: Record<string, unknown> | undefined): AppSettings {
  const fontSize = data?.fontSize;
  const theme = data?.theme;
  return {
    fontSize:
      fontSize === "small" || fontSize === "large" ? fontSize : DEFAULT_SETTINGS.fontSize,
    theme: theme === "light" || theme === "dark" ? theme : DEFAULT_SETTINGS.theme,
    // Only one value is possible today, so there is nothing to read back.
    language: "ja",
  };
}

export async function getSettings(uid: string): Promise<AppSettings> {
  const snap = await getDoc(settingsRef(uid));
  // A student who has never opened the settings screen has no document, which
  // is not an error — it is the defaults.
  return snap.exists() ? parse(snap.data()) : DEFAULT_SETTINGS;
}

export async function saveSettings(
  uid: string,
  patch: Partial<AppSettings>,
): Promise<void> {
  await setDoc(
    settingsRef(uid),
    { ...patch, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
