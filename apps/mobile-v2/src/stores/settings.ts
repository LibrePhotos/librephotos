import { create } from "zustand";

export type ThemePreference = "system" | "light" | "dark";

/**
 * App settings (client state, not synced). The self-hosted server URL lives
 * here so the login screen can set it before any authenticated request. Kept
 * deliberately small; persistence to disk is wired in a later phase (the offline
 * DB work) — for now it holds the in-session server URL + theme choice.
 */
type SettingsState = {
  /** Bare server origin, no trailing slash, no `/api` (e.g. https://demo.librephotos.com). */
  serverUrl: string | null;
  theme: ThemePreference;
  setServerUrl: (url: string) => void;
  setTheme: (theme: ThemePreference) => void;
};

/** Normalize a user-typed server URL: trim, add https:// if missing, drop trailing slashes. */
export function normalizeServerUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "");
}

export const useSettingsStore = create<SettingsState>(set => ({
  serverUrl: null,
  theme: "system",
  setServerUrl: url => set({ serverUrl: normalizeServerUrl(url) }),
  setTheme: theme => set({ theme }),
}));
