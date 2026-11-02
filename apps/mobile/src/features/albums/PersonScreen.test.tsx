import { Alert, type AlertButton } from "react-native";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { upsertPersons } from "@/db/writers";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useToastStore } from "@/stores/toasts";
import { defined } from "@/test/defined";
import { jsonResponse, makeMockClient, mockRouter, renderWithDb } from "@/test/test-utils";
import { PersonScreen } from "./PersonScreen";

const mockRunSync = jest.fn<Promise<null>, [unknown, { userId: number | null; reason: string }]>();
jest.mock("@/sync/run", () => ({
  runSync: (db: unknown, opts: { userId: number | null; reason: string }) => mockRunSync(db, opts),
}));
// The share sheet asks the server who the user is as it mounts; not under test here.
jest.mock("@/features/sharing/ShareSheet", () => ({ ShareSheet: () => null }));
// The outbox trigger reaches for the app's sync singletons.
jest.mock("@/sync/triggers", () => ({ notifyOutboxWrite: () => undefined }));

const PHOTO_A = "00000000-0000-4000-8000-00000000000a";
const PHOTO_B = "00000000-0000-4000-8000-00000000000b";

const LIST = { results: [{ id: 1, date: null, location: "", incomplete: true, numberOfItems: 2, items: [] }] };
const DAY = {
  results: {
    id: 1,
    date: null,
    location: "",
    incomplete: false,
    numberOfItems: 2,
    items: [
      { id: PHOTO_A, image_hash: "hash-a", aspectRatio: 1 },
      { id: PHOTO_B, image_hash: "hash-b", aspectRatio: 1 },
    ],
  },
};

type Sent = { url: string; method: string; body: unknown };

/** A server that knows person 7's photos and accepts every person edit. */
function server(sent: Sent[] = []) {
  return makeMockClient(async (url, init) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") sent.push({ url, method, body: JSON.parse(String(init?.body ?? "null")) });
    if (url.includes("/albums/date/list/")) return jsonResponse(LIST);
    if (url.includes("/albums/date/1/")) return jsonResponse(DAY);
    if (url.includes("/remove-photos/")) return jsonResponse({ removed: 1, photo_count: 1, write_error: null });
    if (url.includes("/merge/")) return jsonResponse({ moved: 3, photo_count: 2, write_queued: false });
    if (url.endsWith("/persons/7/") && method === "DELETE") return new Response(null, { status: 204 });
    if (url.endsWith("/persons/7/") && method === "PATCH") return jsonResponse({ id: 7, name: "Ada" });
    if (url.endsWith("/persons/7/")) {
      return jsonResponse({ id: 7, name: "Ada", face_url: null, face_count: 3, face_photo_url: "hash-a" });
    }
    return jsonResponse({}, 404);
  });
}

function seedPeople(db: TestDb["db"]) {
  upsertPersons(db, [
    { id: 7, name: "Ada", kind: "USER", faceCount: 3, coverPhotoHash: "hash-a", lastModified: 1 },
    { id: 8, name: "Grace", kind: "USER", faceCount: 5, coverPhotoHash: "hash-c", lastModified: 1 },
  ]);
}

function messages(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

/** Stand in for the native confirmation dialog. */
const spyAlert = () => jest.spyOn(Alert, "alert").mockImplementation(() => undefined);

/** The destructive button of the last confirmation the screen asked for. */
function confirmButton(alert: ReturnType<typeof spyAlert>): AlertButton {
  const buttons = alert.mock.calls.at(-1)?.[2] ?? [];
  return defined(buttons.find((b) => b.style === "destructive"), "the confirm button");
}

describe("PersonScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    globalThis.__mockNetworkConnected = true;
    useSettingsStore.setState({ serverUrl: "https://test.local" });
    useAuthStore.setState({ userId: 1 });
    useToastStore.setState({ toasts: [] });
    mockRunSync.mockReset();
    mockRunSync.mockResolvedValue(null);
    jest.clearAllMocks();
  });
  afterEach(() => {
    t.close();
    globalThis.__mockNetworkConnected = true;
    jest.restoreAllMocks();
  });

  it("shows the mirrored name, the photo count and the person's photos", async () => {
    seedPeople(t.db);
    const { getByTestId } = renderWithDb(<PersonScreen id={7} />, t.db, server());
    expect(getByTestId("person-title").props.children).toBe("Ada");
    await waitFor(() => expect(getByTestId("tile-" + PHOTO_B)).toBeTruthy());
    expect(getByTestId("person-count").props.children).toBe("2 photos");
  });

  it("falls back to the server's person when it is not mirrored", async () => {
    const { getByTestId } = renderWithDb(<PersonScreen id={7} />, t.db, server());
    await waitFor(() => expect(getByTestId("person-title").props.children).toBe("Ada"));
  });

  it("shows the offline state with nothing loaded, and keeps rename while offline", async () => {
    globalThis.__mockNetworkConnected = false;
    seedPeople(t.db);
    const { getByTestId } = renderWithDb(<PersonScreen id={7} />, t.db, makeMockClient(async () => jsonResponse({}, 500)));
    await waitFor(() => expect(getByTestId("person-grid-offline")).toBeTruthy());
    expect(getByTestId("person-title").props.children).toBe("Ada");

    fireEvent.press(getByTestId("person-menu-button"));
    await waitFor(() =>
      expect(getByTestId("person-action-merge").props.accessibilityState).toHaveProperty("disabled", true)
    );
    expect(getByTestId("person-action-delete").props.accessibilityState).toHaveProperty("disabled", true);
    expect(getByTestId("person-action-rename").props.accessibilityState).toHaveProperty("disabled", false);
  });

  it("renames through the outbox", async () => {
    seedPeople(t.db);
    const { getByTestId } = renderWithDb(<PersonScreen id={7} />, t.db, server());
    fireEvent.press(getByTestId("person-menu-button"));
    fireEvent.press(getByTestId("person-action-rename"));
    await waitFor(() => expect(getByTestId("person-rename-prompt-input")).toBeTruthy());
    fireEvent.changeText(getByTestId("person-rename-prompt-input"), "Ada Lovelace");
    fireEvent.press(getByTestId("person-rename-prompt-submit"));

    const row = t.db.get<{ name: string }>(sql`SELECT name FROM person WHERE id = 7`);
    expect(row?.name).toBe("Ada Lovelace");
    const kinds = t.db.all<{ kind: string }>(sql`SELECT kind FROM outbox`).map((r) => r.kind);
    expect(kinds).toEqual(["person_rename"]);
  });

  it("sets the cover from the person's photos", async () => {
    seedPeople(t.db);
    const sent: Sent[] = [];
    const { getByTestId } = renderWithDb(<PersonScreen id={7} />, t.db, server(sent));
    await waitFor(() => expect(getByTestId("tile-" + PHOTO_B)).toBeTruthy());

    fireEvent.press(getByTestId("person-menu-button"));
    fireEvent.press(getByTestId("person-action-cover"));
    await waitFor(() => expect(getByTestId("person-cover-picker")).toBeTruthy());
    const picker = getByTestId("person-cover-grid");
    // The picker's grid holds the same photos: pick the second.
    const tiles = picker.findAll((node) => node.props.testID === "tile-" + PHOTO_B);
    await act(async () => fireEvent.press(defined(tiles[0], "the tile in the picker")));

    await waitFor(() => expect(messages()).toContain("Cover photo updated"));
    expect(sent).toEqual([
      { url: "https://test.local/api/persons/7/", method: "PATCH", body: { cover_photo: "hash-b" } },
    ]);
    const row = t.db.get<{ cover_photo_hash: string }>(sql`SELECT cover_photo_hash FROM person WHERE id = 7`);
    expect(row?.cover_photo_hash).toBe("hash-b");
    expect(mockRunSync).toHaveBeenCalledWith(t.db, { userId: 1, reason: "manual" });
  });

  it("merges into another person after confirming, then opens that person", async () => {
    seedPeople(t.db);
    const sent: Sent[] = [];
    const alert = spyAlert();
    const { getByTestId, queryByTestId } = renderWithDb(<PersonScreen id={7} />, t.db, server(sent));

    fireEvent.press(getByTestId("person-menu-button"));
    fireEvent.press(getByTestId("person-action-merge"));
    await waitFor(() => expect(getByTestId("person-merge-8")).toBeTruthy());
    // Not offered to merge into itself.
    expect(queryByTestId("person-merge-7")).toBeNull();
    fireEvent.press(getByTestId("person-merge-8"));

    const [title, message] = alert.mock.calls.at(-1) ?? [];
    expect(title).toBe("Merge Ada into Grace?");
    expect(message).toContain("All 3 faces of Ada move to Grace.");
    expect(sent).toHaveLength(0);
    await act(async () => confirmButton(alert).onPress?.());

    await waitFor(() => expect(mockRouter().replace).toHaveBeenCalledWith("/albums/people/8"));
    expect(sent).toEqual([{ url: "https://test.local/api/persons/8/merge/", method: "POST", body: { person: 7 } }]);
    expect(t.db.get(sql`SELECT id FROM person WHERE id = 7`)).toBeUndefined();
    expect(messages()).toContain("Merged into Grace");
  });

  it("deletes the person after confirming, then goes back", async () => {
    seedPeople(t.db);
    const sent: Sent[] = [];
    const alert = spyAlert();
    const { getByTestId } = renderWithDb(<PersonScreen id={7} />, t.db, server(sent));

    fireEvent.press(getByTestId("person-menu-button"));
    fireEvent.press(getByTestId("person-action-delete"));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert.mock.calls[0]?.[0]).toBe("Delete Ada?");
    await act(async () => confirmButton(alert).onPress?.());

    await waitFor(() => expect(mockRouter().back).toHaveBeenCalled());
    expect(sent).toEqual([{ url: "https://test.local/api/persons/7/", method: "DELETE", body: null }]);
    expect(t.db.get(sql`SELECT id FROM person WHERE id = 7`)).toBeUndefined();
  });

  it("removes selected photos from the person", async () => {
    seedPeople(t.db);
    const sent: Sent[] = [];
    const alert = spyAlert();
    const { getByTestId, queryByTestId } = renderWithDb(<PersonScreen id={7} />, t.db, server(sent));
    await waitFor(() => expect(getByTestId("tile-" + PHOTO_A)).toBeTruthy());

    fireEvent(getByTestId("tile-" + PHOTO_A), "longPress");
    fireEvent.press(getByTestId("action-more"));
    fireEvent.press(getByTestId("action-remove-person"));
    expect(alert.mock.calls.at(-1)?.[0]).toBe("Remove 1 photo from Ada?");
    await act(async () => confirmButton(alert).onPress?.());

    await waitFor(() => expect(messages()).toContain("Removed 1 photo from Ada"));
    expect(sent).toEqual([
      { url: "https://test.local/api/persons/7/remove-photos/", method: "POST", body: { photo_ids: [PHOTO_A] } },
    ]);
    expect(queryByTestId("selection-action-bar")).toBeNull();
  });
});
