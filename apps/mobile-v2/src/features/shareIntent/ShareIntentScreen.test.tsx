import { fireEvent, waitFor } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { ShareIntentScreen, parseSharedItems } from "./ShareIntentScreen";
import { renderWithDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/stores/toasts";

jest.mock("@/sync/run", () => ({ runSync: jest.fn() }));

function setParams(items: unknown[]) {
  (globalThis as { __mockSearchParams?: unknown }).__mockSearchParams = { items: JSON.stringify(items) };
}

describe("parseSharedItems", () => {
  it("parses a JSON array of shared items and skips invalid entries", () => {
    const out = parseSharedItems(JSON.stringify([{ uri: "content://a" }, { name: "no-uri" }]));
    expect(out).toHaveLength(1);
    expect(out[0]!.uri).toBe("content://a");
  });
  it("returns [] for missing/garbage input", () => {
    expect(parseSharedItems(undefined)).toEqual([]);
    expect(parseSharedItems("not json")).toEqual([]);
  });
});

describe("ShareIntentScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    useAuthStore.setState({ userId: 1 });
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => {
    t.close();
    (globalThis as { __mockSearchParams?: unknown }).__mockSearchParams = undefined;
  });

  it("renders shared thumbnails and enqueues them as one-off uploads", async () => {
    setParams([{ uri: "content://a", name: "a.jpg" }, { uri: "content://b" }]);
    const { getByTestId } = renderWithDb(<ShareIntentScreen />, t.db);

    await waitFor(() => expect(getByTestId("share-upload")).toBeTruthy());
    fireEvent.press(getByTestId("share-upload"));

    const count = t.db.get(sql`SELECT COUNT(*) AS c FROM upload_queue WHERE state = 'pending'`) as { c: number };
    expect(count.c).toBe(2);
    expect(useToastStore.getState().toasts.at(-1)?.level).toBe("info");
  });

  it("shows an empty state when nothing was shared", async () => {
    setParams([]);
    const { getByTestId } = renderWithDb(<ShareIntentScreen />, t.db);
    await waitFor(() => expect(getByTestId("share-empty")).toBeTruthy());
  });
});
