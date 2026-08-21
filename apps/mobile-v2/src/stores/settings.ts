import { create } from "zustand";
import { serverStorage } from "@/lib/tokenStorage";

export type ThemePreference = "system" | "light" | "dark";

/**
 * App settings (client state, not synced). The self-hosted server URL lives
 * here so the login screen can set it before any authenticated request. Kept
 * deliberately small; persistence to disk is wired in a later phase (the offline
 * DB work) — for now it holds the in-session server URL + theme choice.
 */
/** Default thumbnail-cache byte cap (2 GB), mirrored from sync/thumbs. */
export const DEFAULT_THUMB_CAP_BYTES = 2 * 1024 * 1024 * 1024;

type SettingsState = {
  /** Bare server origin, no trailing slash, no `/api` (e.g. https://demo.librephotos.com). */
  serverUrl: string | null;
  theme: ThemePreference;
  /** Active UI locale code (e.g. "en", "de", "zh_Hans"). */
  locale: string;
  /** LRU cap for the on-device thumbnail cache (doc 01 / thumb_cache). */
  thumbCapBytes: number;
  setServerUrl: (url: string) => void;
  /** Restore the persisted server URL. Must complete before any sync runs. */
  hydrateServerUrl: () => Promise<string | null>;
  setTheme: (theme: ThemePreference) => void;
  setLocale: (locale: string) => void;
  setThumbCapBytes: (bytes: number) => void;
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
  locale: "en",
  thumbCapBytes: DEFAULT_THUMB_CAP_BYTES,
  setServerUrl: url => {
    const normalized = normalizeServerUrl(url);
    set({ serverUrl: normalized });
    // Fire-and-forget: the in-memory value is what this session uses; the write
    // only has to win before the next cold start.
    void serverStorage.set(normalized);
  },
  async hydrateServerUrl() {
    const stored = await serverStorage.get();
    if (stored) set({ serverUrl: stored });
    return stored;
  },
  setTheme: theme => set({ theme }),
  setLocale: locale => set({ locale }),
  setThumbCapBytes: bytes => set({ thumbCapBytes: bytes }),
}));
