import { create } from "zustand";
import { AVAILABLE_LOCALES } from "@/i18n/locales";
import { preferencesStorage } from "@/lib/preferencesStorage";
import { DEFAULT_USER_ALBUM_SORT, isUserAlbumSort, type UserAlbumSort } from "@/lib/albumSort";
import { serverStorage } from "@/lib/tokenStorage";

export type ThemePreference = "system" | "light" | "dark";

/**
 * App settings (client state, not synced). The self-hosted server URL lives
 * here so the login screen can set it before any authenticated request; it is
 * persisted next to the tokens in secure-store (see tokenStorage). The local
 * preferences (theme, language, thumbnail cache cap) are persisted in the
 * preferences key-value store and read synchronously when this module loads, so
 * the first frame already uses them.
 */
/** Default thumbnail-cache byte cap (2 GB), mirrored from sync/thumbs. */
export const DEFAULT_THUMB_CAP_BYTES = 2 * 1024 * 1024 * 1024;

/** Storage key of the persisted {@link Preferences} JSON blob. */
export const PREFERENCES_KEY = "librephotos.preferences";

/** The locally persisted subset of the settings. */
export type Preferences = {
  theme: ThemePreference;
  /** Active UI locale code (e.g. "en", "de", "zh_Hans"). */
  locale: string;
  /** LRU cap for the on-device thumbnail cache (doc 01 / thumb_cache). */
  thumbCapBytes: number;
  /** Order of the My Albums list (its header's sort menu). */
  albumSort: UserAlbumSort;
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  locale: "en",
  thumbCapBytes: DEFAULT_THUMB_CAP_BYTES,
  albumSort: DEFAULT_USER_ALBUM_SORT,
};

type SettingsState = Preferences & {
  /** Bare server origin, no trailing slash, no `/api` (e.g. https://demo.librephotos.com). */
  serverUrl: string | null;
  setServerUrl: (url: string) => void;
  /** Restore the persisted server URL. Must complete before any sync runs. */
  hydrateServerUrl: () => Promise<string | null>;
  setTheme: (theme: ThemePreference) => void;
  setLocale: (locale: string) => void;
  setThumbCapBytes: (bytes: number) => void;
  setAlbumSort: (sort: UserAlbumSort) => void;
};

/** Normalize a user-typed server URL: trim, add https:// if missing, drop trailing slashes. */
export function normalizeServerUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isKnownLocale(value: unknown): value is string {
  return typeof value === "string" && AVAILABLE_LOCALES.some(l => l.code === value);
}

function isThumbCap(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Parse a stored preferences blob. Each field is validated on its own, so a
 * corrupt or outdated value (a locale that was dropped, a hand-edited cap)
 * falls back to its default without discarding the others.
 */
export function parsePreferences(raw: string | null): Preferences {
  if (!raw) return { ...DEFAULT_PREFERENCES };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
  if (!isRecord(parsed)) return { ...DEFAULT_PREFERENCES };
  return {
    theme: isThemePreference(parsed.theme) ? parsed.theme : DEFAULT_PREFERENCES.theme,
    locale: isKnownLocale(parsed.locale) ? parsed.locale : DEFAULT_PREFERENCES.locale,
    thumbCapBytes: isThumbCap(parsed.thumbCapBytes) ? parsed.thumbCapBytes : DEFAULT_PREFERENCES.thumbCapBytes,
    albumSort: isUserAlbumSort(parsed.albumSort) ? parsed.albumSort : DEFAULT_PREFERENCES.albumSort,
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  /** Apply a preference change in memory, then write the whole set to disk. */
  const setPreference = (patch: Partial<Preferences>) => {
    set(patch);
    const { theme, locale, thumbCapBytes, albumSort } = get();
    const prefs: Preferences = { theme, locale, thumbCapBytes, albumSort };
    // Fire-and-forget like the server URL: this session already uses the
    // in-memory value; the write only has to land before the next cold start.
    void preferencesStorage.set(PREFERENCES_KEY, JSON.stringify(prefs));
  };

  return {
    serverUrl: null,
    // Synchronous hydration: the store starts from what was saved, so nothing
    // renders in the default theme / language first.
    ...parsePreferences(preferencesStorage.getSync(PREFERENCES_KEY)),
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
    setTheme: theme => setPreference({ theme }),
    setLocale: locale => setPreference({ locale }),
    setThumbCapBytes: bytes => setPreference({ thumbCapBytes: bytes }),
    setAlbumSort: albumSort => setPreference({ albumSort }),
  };
});
