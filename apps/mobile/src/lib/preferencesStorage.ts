import { SQLiteStorage } from "expo-sqlite/kv-store";

/**
 * On-device storage for local app preferences (theme, language, thumbnail cache
 * cap). Backed by expo-sqlite's key-value store, in its own database file:
 *
 * - It is already a dependency (expo-sqlite runs the mirror) and works in Expo
 *   Go, so no new native module.
 * - Unlike the mirror's `app_meta` table it needs no migration and no
 *   `DatabaseGate`: the theme is needed for the very first frame (the root
 *   spinner, the login screen), long before the mirror is opened and migrated.
 * - It has a synchronous read, so the settings store can start from the saved
 *   values and the first frame is already in the right theme and language — no
 *   flash from the defaults.
 * - Preferences are not secrets, so secure-store (Keychain / Keystore, meant for
 *   the tokens) is the wrong home for them.
 *
 * A separate file keeps preferences out of the mirror's reset/wipe paths.
 */
const PREFERENCES_DB = "librephotos-preferences.db";

let storage: SQLiteStorage | null = null;

function store(): SQLiteStorage {
  storage ??= new SQLiteStorage(PREFERENCES_DB);
  return storage;
}

export const preferencesStorage = {
  /** Synchronous read; `null` when unset or when storage is unavailable. */
  getSync(key: string): string | null {
    try {
      return store().getItemSync(key);
    } catch (error) {
      console.warn("[preferences] read failed", error);
      return null;
    }
  },
  /** Persist a value. Failures are logged: the in-memory value still applies. */
  async set(key: string, value: string): Promise<void> {
    try {
      await store().setItemAsync(key, value);
    } catch (error) {
      console.warn("[preferences] write failed", error);
    }
  },
};
