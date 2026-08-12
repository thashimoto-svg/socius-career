"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import {
  DEFAULT_SETTINGS,
  FONT_SCALE,
  getSettings,
  saveSettings,
  type AppSettings,
} from "@/lib/firebase/settings";
import { LOAD_TIMEOUT_MS, withTimeout } from "@/lib/with-timeout";

/**
 * Applies the student's appearance settings to the document, and remembers
 * them.
 *
 * Both settings are one property on <html>: `data-theme` picks the palette,
 * `--sc-font-scale` scales every size. Nothing else in the app has to know
 * either exists — the tokens in lib/theme.ts point at CSS variables, and the
 * variables are what change.
 *
 * Writes are optimistic. The student is looking at the thing they just
 * changed, so the screen changing before Firestore acknowledges is not a
 * guess; it is the only honest order.
 */

type SettingsContextValue = {
  settings: AppSettings;
  /** True until the saved settings have been read at least once. */
  loading: boolean;
  update: (patch: Partial<AppSettings>) => void;
};

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  loading: false,
  update: () => {},
});

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

/**
 * A local mirror of the last applied settings.
 *
 * Firestore is the record; this is so the app does not open in the wrong
 * colours. Reading the document takes a round trip, and a student who chose
 * 「ダーク」 on a phone set to light would otherwise get a white flash on every
 * launch — which is the one moment a dark theme is chosen to avoid.
 */
const MIRROR_KEY = "sc-settings";

function readMirror(): AppSettings | null {
  try {
    const raw = window.localStorage.getItem(MIRROR_KEY);
    return raw ? ({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as AppSettings) : null;
  } catch {
    // Private mode, disabled storage, or something that is not JSON. The
    // defaults are a working app.
    return null;
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  // Not an initialiser: reading localStorage during render would make the
  // first client render disagree with the server's, and React would throw the
  // whole tree away to fix it. One frame of defaults is cheaper.
  useEffect(() => {
    const mirrored = readMirror();
    if (mirrored) setSettings(mirrored);
  }, []);

  useEffect(() => {
    // Signed out, the mirror is all there is — and it is the right thing to
    // use: the login screen belongs to whoever last used this device.
    if (!user) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Bounded like every other read in the app. Nothing renders on this
    // provider's `loading` today, but a promise that never settles is a
    // loading state waiting for someone to gate on it.
    withTimeout(getSettings(user.uid), LOAD_TIMEOUT_MS, "settings read timed out")
      .then((saved) => {
        if (!cancelled) setSettings(saved);
      })
      .catch(() => {
        // Unreadable settings are not worth an error message. The defaults are
        // a working app.
        if (!cancelled) setSettings(DEFAULT_SETTINGS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  // The whole effect of this provider on the app.
  useEffect(() => {
    try {
      window.localStorage.setItem(MIRROR_KEY, JSON.stringify(settings));
    } catch {
      // Storage being unavailable costs a flash on next launch, nothing more.
    }

    const root = document.documentElement;
    root.style.setProperty("--sc-font-scale", String(FONT_SCALE[settings.fontSize]));

    if (settings.theme === "system") {
      // Removed rather than set to "system": the stylesheet's rule is
      // :root:not([data-theme="light"]) inside a prefers-color-scheme query, so
      // absence is what hands the decision back to the device.
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", settings.theme);
    }
  }, [settings]);

  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      if (user) void saveSettings(user.uid, patch);
    },
    [user],
  );

  return (
    <SettingsContext.Provider value={{ settings, loading, update }}>
      {children}
    </SettingsContext.Provider>
  );
}
