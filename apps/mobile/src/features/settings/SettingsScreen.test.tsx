import { fireEvent, waitFor } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { SettingsScreen } from "./SettingsScreen";
import { renderWithDb, makeMockClient, jsonResponse } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useToastStore } from "@/stores/toasts";
import SELF_USER from "../../../../../packages/api-client/src/__tests__/fixtures/user.json";

// Avoid pulling the expo-native sync chain (and real network) into the test.
jest.mock("@/sync/run", () => ({ runSync: jest.fn() }));

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
  beforeEach(() => {
    t = createTestDb();
    useAuthStore.setState({ userId: 1 });
    useToastStore.setState({ toasts: [] });
    useSettingsStore.setState({ theme: "system", locale: "en", thumbCapBytes: 2 * 1024 * 1024 * 1024 });
    (globalThis as { __mockNetworkConnected?: boolean }).__mockNetworkConnected = true;
  });
  afterEach(() => t.close());

  it("switches the theme preference", async () => {
    const { getByTestId } = renderWithDb(<SettingsScreen />, t.db, client());
    fireEvent.press(getByTestId("theme-dark"));
    expect(useSettingsStore.getState().theme).toBe("dark");
  });

  it("changes the UI language", async () => {
    const { getByTestId } = renderWithDb(<SettingsScreen />, t.db, client());
    fireEvent.press(getByTestId("settings-language"));
    await waitFor(() => expect(getByTestId("language-de")).toBeTruthy());
    fireEvent.press(getByTestId("language-de"));
    expect(useSettingsStore.getState().locale).toBe("de");
  });

  it("sets the thumb cache cap and clears the cache", async () => {
    t.db.run(
      sql`INSERT INTO thumb_cache (photo_id, file_path, size_bytes, last_used) VALUES ('p', '/x', 1000, 1)`
    );
    const { getByTestId } = renderWithDb(<SettingsScreen />, t.db, client());
    fireEvent.press(getByTestId("cap-5"));
    expect(useSettingsStore.getState().thumbCapBytes).toBe(5 * 1024 * 1024 * 1024);

    fireEvent.press(getByTestId("clear-cache"));
    const row = t.db.get(sql`SELECT COUNT(*) AS c FROM thumb_cache`) as { c: number };
    expect(row.c).toBe(0);
  });

  it("toggles a backup rule", async () => {
    const { getByTestId } = renderWithDb(<SettingsScreen />, t.db, client());
    fireEvent(getByTestId("toggle-charging"), "valueChange", true);
    const row = t.db.get(sql`SELECT value FROM app_meta WHERE key = 'backup_charging_only'`) as { value: string };
    expect(row.value).toBe("1");
  });

  it("patches favorite_min_rating on the server", async () => {
    let body: unknown;
    const { getByTestId } = renderWithDb(<SettingsScreen />, t.db, client((b) => (body = b)));
    await waitFor(() => expect(getByTestId("fav-rating-2")).toBeTruthy());
    fireEvent.press(getByTestId("fav-rating-2"));
    await waitFor(() => expect(body).toEqual({ favorite_min_rating: 2 }));
  });

  it("changes the password", async () => {
    let body: unknown;
    const { getByTestId } = renderWithDb(<SettingsScreen />, t.db, client((b) => (body = b)));
    fireEvent.press(getByTestId("change-password"));
    fireEvent.changeText(getByTestId("password-prompt-input"), "newsecret");
    fireEvent.press(getByTestId("password-prompt-submit"));
    await waitFor(() => expect(body).toEqual({ password: "newsecret" }));
  });
});
