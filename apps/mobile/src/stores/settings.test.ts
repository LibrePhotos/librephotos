import {
  DEFAULT_PREFERENCES,
  DEFAULT_THUMB_CAP_BYTES,
  PREFERENCES_KEY,
  parsePreferences,
  useSettingsStore,
} from "@/stores/settings";

/** The in-memory kv-store from jest.setup.js (stands in for the SQLite file). */
const kv = jest.requireMock<{ __store: Map<string, string>; __reset: () => void }>("expo-sqlite/kv-store");

/** What a cold start would read back from disk. */
function persisted(): unknown {
  const raw = kv.__store.get(PREFERENCES_KEY);
  return raw == null ? null : JSON.parse(raw);
}

/** Load a fresh copy of the store module, as a cold start would. */
function coldStartStore(): typeof useSettingsStore {
  let fresh: typeof useSettingsStore | undefined;
  jest.isolateModules(() => {
    fresh = jest.requireActual<typeof import("@/stores/settings")>("@/stores/settings").useSettingsStore;
  });
  if (!fresh) throw new Error("settings store did not load");
  return fresh;
}

describe("settings store: local preferences persist across restarts", () => {
  beforeEach(() => {
    kv.__reset();
    useSettingsStore.setState({ ...DEFAULT_PREFERENCES });
  });

  it("writes theme, language and cache cap when they change", async () => {
    const s = useSettingsStore.getState();
    s.setTheme("dark");
    s.setLocale("de");
    s.setThumbCapBytes(5 * 1024 * 1024 * 1024);
    await Promise.resolve();
    expect(persisted()).toEqual({ theme: "dark", locale: "de", thumbCapBytes: 5 * 1024 * 1024 * 1024 });
  });

  it("starts from the saved preferences on a cold start", () => {
    kv.__store.set(PREFERENCES_KEY, JSON.stringify({ theme: "light", locale: "fr", thumbCapBytes: 1024 }));
    const state = coldStartStore().getState();
    expect(state).toMatchObject({ theme: "light", locale: "fr", thumbCapBytes: 1024 });
  });

  it("round-trips: a change made in one session is there in the next", async () => {
    useSettingsStore.getState().setTheme("dark");
    useSettingsStore.getState().setLocale("ar");
    await Promise.resolve();
    expect(coldStartStore().getState()).toMatchObject({ theme: "dark", locale: "ar" });
  });

  it("uses the defaults on first launch", () => {
    expect(coldStartStore().getState()).toMatchObject(DEFAULT_PREFERENCES);
  });
});

describe("parsePreferences", () => {
  it("falls back per field, keeping the valid ones", () => {
    expect(parsePreferences(JSON.stringify({ theme: "sepia", locale: "de", thumbCapBytes: -1 }))).toEqual({
      theme: "system",
      locale: "de",
      thumbCapBytes: DEFAULT_THUMB_CAP_BYTES,
    });
    expect(parsePreferences(JSON.stringify({ theme: "dark", locale: "xx", thumbCapBytes: "big" }))).toEqual({
      theme: "dark",
      locale: "en",
      thumbCapBytes: DEFAULT_THUMB_CAP_BYTES,
    });
  });

  it("ignores missing or corrupt data", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("{not json")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("[1,2]")).toEqual(DEFAULT_PREFERENCES);
  });
});
