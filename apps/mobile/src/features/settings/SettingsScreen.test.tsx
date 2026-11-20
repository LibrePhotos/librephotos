import { fireEvent, waitFor } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { SettingsScreen } from "./SettingsScreen";
import { renderWithDb, makeMockClient, jsonResponse, settleDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@librephotos/local-db/testing";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useToastStore } from "@/stores/toasts";
import { getMemoriesNotifPrefs, setMemoriesNotifPrefs } from "@librephotos/local-db";
import { rescheduleMemoriesReminders } from "@/features/memories/reminders";
import SELF_USER from "../../../../../packages/api-client/src/__tests__/fixtures/user.json";

// Avoid pulling the expo-native sync chain (and real network) into the test.
jest.mock("@/sync/run", () => ({ runSync: jest.fn<void, unknown[]>() }));
jest.mock("@/features/memories/reminders", () => ({
  rescheduleMemoriesReminders: jest.fn(async () => true),
}));

function client(onPatch?: (body: unknown) => void) {
  return makeMockClient(async (url, init) => {
    if (url.includes("/user/1/") && init?.method === "PATCH") {
      onPatch?.(JSON.parse(String(init.body)));
      return jsonResponse({ ...SELF_USER, favorite_min_rating: 2 });
    }
    if (url.includes("/user/1/")) return jsonResponse({ ...SELF_USER, favorite_min_rating: 4 });
    return jsonResponse({}, 404);
  });
}

describe("SettingsScreen", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
    useAuthStore.setState({ userId: 1 });
    useToastStore.setState({ toasts: [] });
    useSettingsStore.setState({ theme: "system", locale: "en", thumbCapBytes: 2 * 1024 * 1024 * 1024 });
    globalThis.__mockNetworkConnected = true;
  });
  afterEach(() => t.close());

  it("switches the theme preference", async () => {
    const { getByTestId } = await renderWithDb(<SettingsScreen />, t.db, client());
    fireEvent.press(getByTestId("theme-dark"));
    await settleDb();
    expect(useSettingsStore.getState().theme).toBe("dark");
  });

  it("changes the UI language", async () => {
    const { getByTestId } = await renderWithDb(<SettingsScreen />, t.db, client());
    fireEvent.press(getByTestId("settings-language"));
    await settleDb();
    await waitFor(() => expect(getByTestId("language-de")).toBeTruthy());
    fireEvent.press(getByTestId("language-de"));
    await settleDb();
    expect(useSettingsStore.getState().locale).toBe("de");
  });

  it("sets the thumb cache cap and clears the cache", async () => {
    await t.db.run(
      sql`INSERT INTO thumb_cache (photo_id, file_path, size_bytes, last_used) VALUES ('p', '/x', 1000, 1)`
    );
    const { getByTestId } = await renderWithDb(<SettingsScreen />, t.db, client());
    fireEvent.press(getByTestId("cap-5"));
    await settleDb();
    expect(useSettingsStore.getState().thumbCapBytes).toBe(5 * 1024 * 1024 * 1024);

    fireEvent.press(getByTestId("clear-cache"));

    await settleDb();
    const row = await t.db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM thumb_cache`);
    expect(row.c).toBe(0);
  });

  it("toggles a backup rule", async () => {
    const { getByTestId } = await renderWithDb(<SettingsScreen />, t.db, client());
    fireEvent(getByTestId("toggle-charging"), "valueChange", true);
    await settleDb();
    const row = await t.db.get<{ value: string }>(sql`SELECT value FROM app_meta WHERE key = 'backup_charging_only'`);
    expect(row.value).toBe("1");
  });

  it("patches favorite_min_rating on the server", async () => {
    let body: unknown;
    const { getByTestId } = await renderWithDb(<SettingsScreen />, t.db, client((b) => (body = b)));
    await waitFor(() => expect(getByTestId("fav-rating-2")).toBeTruthy());
    fireEvent.press(getByTestId("fav-rating-2"));
    await settleDb();
    await waitFor(() => expect(body).toEqual({ favorite_min_rating: 2 }));
  });

  it("changes the password", async () => {
    let body: unknown;
    const { getByTestId } = await renderWithDb(<SettingsScreen />, t.db, client((b) => (body = b)));
    fireEvent.press(getByTestId("change-password"));
    await settleDb();
    fireEvent.changeText(getByTestId("password-prompt-input"), "newsecret");
    await settleDb();
    fireEvent.press(getByTestId("password-prompt-submit"));
    await settleDb();
    await waitFor(() => expect(body).toEqual({ password: "newsecret" }));
  });

  describe("memories reminder (#2746)", () => {
    beforeEach(() => jest.mocked(rescheduleMemoriesReminders).mockClear());

    it("turning it on plans the reminders, asking for the permission", async () => {
      const { getByTestId } = await renderWithDb(<SettingsScreen />, t.db, client());
      fireEvent(getByTestId("toggle-memories-notif"), "valueChange", true);
      await settleDb();
      await waitFor(() =>
        expect(rescheduleMemoriesReminders).toHaveBeenCalledWith(t.db, { requestPermission: true })
      );
      expect((await getMemoriesNotifPrefs(t.db)).enabled).toBe(true);
    });

    it("turns it back off when the permission is refused", async () => {
      jest.mocked(rescheduleMemoriesReminders).mockResolvedValueOnce(false);
      const { getByTestId } = await renderWithDb(<SettingsScreen />, t.db, client());
      fireEvent(getByTestId("toggle-memories-notif"), "valueChange", true);
      await settleDb();
      await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
      expect((await getMemoriesNotifPrefs(t.db)).enabled).toBe(false);
    });

    it("plans again for a new time and a new language", async () => {
      await setMemoriesNotifPrefs(t.db, { enabled: true });
      const { getByTestId } = await renderWithDb(<SettingsScreen />, t.db, client());
      fireEvent.press(getByTestId("memories-notif-time"));
      await settleDb();
      fireEvent.changeText(getByTestId("reminder-time-prompt-input"), "18:30");
      await settleDb();
      fireEvent.press(getByTestId("reminder-time-prompt-submit"));
      await settleDb();
      await waitFor(() => expect(rescheduleMemoriesReminders).toHaveBeenCalledWith(t.db));
      expect(await getMemoriesNotifPrefs(t.db)).toMatchObject({ hour: 18, minute: 30 });

      jest.mocked(rescheduleMemoriesReminders).mockClear();
      fireEvent.press(getByTestId("settings-language"));
      await settleDb();
      await waitFor(() => expect(getByTestId("language-de")).toBeTruthy());
      fireEvent.press(getByTestId("language-de"));
      await settleDb();
      await waitFor(() => expect(rescheduleMemoriesReminders).toHaveBeenCalledWith(t.db));
    });
  });
});
