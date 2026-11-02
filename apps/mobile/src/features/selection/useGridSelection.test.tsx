import { Alert, Pressable, View, type AlertButton } from "react-native";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useToastStore } from "@/stores/toasts";
import { jsonResponse, makeMockClient, renderWithDb } from "@/test/test-utils";
import type { ApiClient } from "@librephotos/api-client";
import type { ReactElement } from "react";
import type { SelectableItem } from "./reducer";
import type { SaveToDeviceArgs, SaveToDeviceResult } from "./saveToDevice";
import { useGridSelection, type SelectionDirections } from "./useGridSelection";

const mockSaveToDevice = jest.fn<Promise<SaveToDeviceResult>, [SaveToDeviceArgs]>();
jest.mock("./saveToDevice", () => ({
  saveToDevice: (args: SaveToDeviceArgs) => mockSaveToDevice(args),
}));
const mockRunSync = jest.fn<Promise<null>, [unknown, { userId: number | null; reason: string }]>();
jest.mock("@/sync/run", () => ({
  runSync: (db: unknown, opts: { userId: number | null; reason: string }) => mockRunSync(db, opts),
}));

// The share sheet asks the server who the user is as it mounts; not under test here.
jest.mock("@/features/sharing/ShareSheet", () => ({ ShareSheet: () => null }));

/** A grid in miniature: tap enters/toggles selection, the hook draws the bar. */
function Grid({ items, directions }: { items: SelectableItem[]; directions?: SelectionDirections }) {
  const selection = useGridSelection(directions);
  return (
    <View>
      {items.map((item) => (
        <Pressable
          key={item.key}
          testID={`pick-${item.key}`}
          onPress={() => (selection.active ? selection.toggle(item) : selection.enter(item))}
        />
      ))}
      {selection.overlay}
    </View>
  );
}

/** Render, then let the connectivity check settle (it sets state once it answers). */
async function renderGrid(ui: ReactElement, db: TestDb["db"], client?: ApiClient) {
  const utils = renderWithDb(ui, db, client);
  await act(async () => {});
  return utils;
}

const serverOnly: SelectableItem = { key: "a", photoId: "id-a", imageHash: "hash-a", localUri: null };
const onBoth: SelectableItem = { key: "b", photoId: "id-b", imageHash: "hash-b", localUri: "ph://b" };
const phoneOnly: SelectableItem = { key: "c", photoId: null, imageHash: "hash-c", localUri: "ph://c" };

const TRASH: SelectionDirections = { deleted: false };

function messages(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

describe("useGridSelection online actions", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    useSettingsStore.setState({ serverUrl: "https://test.local" });
    useAuthStore.setState({ userId: 1 });
    useToastStore.setState({ toasts: [] });
    mockSaveToDevice.mockReset();
    mockRunSync.mockReset();
    mockRunSync.mockResolvedValue(null);
  });
  afterEach(() => {
    t.close();
    jest.restoreAllMocks();
  });

  it("saves only the server photos that are not on the phone, then leaves selection mode", async () => {
    mockSaveToDevice.mockResolvedValue({ kind: "done", saved: 1, failed: 0 });
    const { getByTestId, queryByTestId } = await renderGrid(<Grid items={[serverOnly, onBoth, phoneOnly]} />, t.db);

    fireEvent.press(getByTestId("pick-a"));
    fireEvent.press(getByTestId("pick-b"));
    fireEvent.press(getByTestId("pick-c"));
    fireEvent.press(getByTestId("action-more"));
    fireEvent.press(getByTestId("action-download"));

    await waitFor(() => expect(messages()).toContain("Saved 1 item to your phone"));
    expect(mockSaveToDevice).toHaveBeenCalledTimes(1);
    expect(mockSaveToDevice.mock.calls[0]?.[0]).toMatchObject({
      imageHashes: ["hash-a"],
      serverAddress: "https://test.local",
    });
    expect(messages()).toContain("Saving 1 item to your phone…");
    expect(queryByTestId("selection-action-bar")).toBeNull();
  });

  it("offers no download when everything selected is on the phone already", async () => {
    const { getByTestId, queryByTestId } = await renderGrid(<Grid items={[onBoth, phoneOnly]} />, t.db);
    fireEvent.press(getByTestId("pick-b"));
    fireEvent.press(getByTestId("pick-c"));
    expect(getByTestId("selection-action-bar")).toBeTruthy();
    fireEvent.press(getByTestId("action-more"));
    expect(queryByTestId("action-download")).toBeNull();
  });

  it("says so when the gallery permission is refused", async () => {
    mockSaveToDevice.mockResolvedValue({ kind: "permissionDenied" });
    const { getByTestId } = await renderGrid(<Grid items={[serverOnly]} />, t.db);
    fireEvent.press(getByTestId("pick-a"));
    fireEvent.press(getByTestId("action-more"));
    fireEvent.press(getByTestId("action-download"));
    await waitFor(() =>
      expect(messages()).toContain("Allow LibrePhotos to add photos to your gallery to save them")
    );
  });

  it("offers Delete permanently only in the Trash", async () => {
    const timeline = await renderGrid(<Grid items={[serverOnly]} />, t.db);
    fireEvent.press(timeline.getByTestId("pick-a"));
    fireEvent.press(timeline.getByTestId("action-more"));
    expect(timeline.queryByTestId("action-delete-permanent")).toBeNull();
    timeline.unmount();

    const trash = await renderGrid(<Grid items={[serverOnly]} directions={TRASH} />, t.db);
    fireEvent.press(trash.getByTestId("pick-a"));
    fireEvent.press(trash.getByTestId("action-more"));
    expect(trash.getByTestId("action-delete-permanent")).toBeTruthy();
  });

  it("asks first, then deletes on the server, drops the rows from the mirror and syncs", async () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "id-a", imageHash: "hash-a", inTrashcan: true }),
      remotePhoto({ id: "id-b", imageHash: "hash-b", inTrashcan: true }),
      // Another user's photo with the same hash is not the server's to delete for us.
      remotePhoto({ id: "id-x", imageHash: "hash-a", ownerId: 2 }),
    ]);
    const requests: { url: string; method?: string; body: unknown }[] = [];
    const client = makeMockClient(async (url, init) => {
      requests.push({ url, method: init?.method, body: JSON.parse(String(init?.body ?? "null")) });
      return jsonResponse({ status: true, results: ["hash-a"], deleted: ["hash-a"], not_deleted: ["hash-b"] });
    });
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);

    const { getByTestId, queryByTestId } = await renderGrid(
      <Grid items={[serverOnly, onBoth]} directions={TRASH} />,
      t.db,
      client
    );
    fireEvent.press(getByTestId("pick-a"));
    fireEvent.press(getByTestId("pick-b"));
    fireEvent.press(getByTestId("action-more"));
    fireEvent.press(getByTestId("action-delete-permanent"));

    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0] ?? [];
    expect(title).toBe("Delete 2 items permanently?");
    expect(message).toContain("can't be undone");
    expect(requests).toHaveLength(0);

    const confirm = (buttons ?? []).find((b: AlertButton) => b.style === "destructive");
    await act(async () => confirm?.onPress?.());

    await waitFor(() => expect(mockRunSync).toHaveBeenCalledWith(t.db, { userId: 1, reason: "manual" }));
    expect(requests).toEqual([
      {
        url: "https://test.local/api/photosedit/delete/",
        method: "DELETE",
        body: { image_hashes: ["hash-a", "hash-b"] },
      },
    ]);
    const left = t.db.all<{ id: string }>(sql`SELECT id FROM remote_photo ORDER BY id`).map((r) => r.id);
    expect(left).toEqual(["id-b", "id-x"]);
    expect(messages()).toEqual(
      expect.arrayContaining(["Deleted 1 item permanently", "1 item could not be deleted"])
    );
    expect(queryByTestId("selection-action-bar")).toBeNull();
  });

  it("does nothing when the confirmation is cancelled", async () => {
    const fetchCalls: string[] = [];
    const client = makeMockClient(async (url) => {
      fetchCalls.push(url);
      return jsonResponse({}, 404);
    });
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { getByTestId } = await renderGrid(<Grid items={[serverOnly]} directions={TRASH} />, t.db, client);
    fireEvent.press(getByTestId("pick-a"));
    fireEvent.press(getByTestId("action-more"));
    fireEvent.press(getByTestId("action-delete-permanent"));

    const cancel = (alert.mock.calls[0]?.[2] ?? []).find((b: AlertButton) => b.style === "cancel");
    act(() => cancel?.onPress?.());

    expect(fetchCalls).toHaveLength(0);
    expect(getByTestId("selection-action-bar")).toBeTruthy();
  });

  it("reports a failed delete and leaves the mirror alone", async () => {
    seedRemotePhotos(t.db, [remotePhoto({ id: "id-a", imageHash: "hash-a", inTrashcan: true })]);
    const client = makeMockClient(async () => jsonResponse({ detail: "boom" }, 500));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { getByTestId } = await renderGrid(<Grid items={[serverOnly]} directions={TRASH} />, t.db, client);
    fireEvent.press(getByTestId("pick-a"));
    fireEvent.press(getByTestId("action-more"));
    fireEvent.press(getByTestId("action-delete-permanent"));
    const confirm = (alert.mock.calls[0]?.[2] ?? []).find((b: AlertButton) => b.style === "destructive");
    await act(async () => confirm?.onPress?.());

    await waitFor(() =>
      expect(messages()).toContain("Could not delete. Check your connection and try again.")
    );
    expect(t.db.all(sql`SELECT id FROM remote_photo`)).toHaveLength(1);
    expect(mockRunSync).not.toHaveBeenCalled();
  });
});

/** A grid inside a user album: the bar gains remove + set-as-cover. */
function AlbumGrid({ items, albumId }: { items: SelectableItem[]; albumId: number }) {
  const selection = useGridSelection({}, { albumId, title: "Trip" });
  return (
    <View>
      {items.map((item) => (
        <Pressable
          key={item.key}
          testID={`pick-${item.key}`}
          onPress={() => (selection.active ? selection.toggle(item) : selection.enter(item))}
        />
      ))}
      {selection.overlay}
    </View>
  );
}

/** A JSON outbox payload, as data. */
const parsePayload = (payload: string): unknown => JSON.parse(payload);

describe("useGridSelection More actions", () => {
  let t: TestDb;
  const outbox = () => t.db.all<{ kind: string; payload: string }>(sql`SELECT kind, payload FROM outbox ORDER BY id`);
  beforeEach(() => {
    t = createTestDb();
    useAuthStore.setState({ userId: 1 });
    useToastStore.setState({ toasts: [] });
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "id-a", imageHash: "hash-a" }),
      remotePhoto({ id: "id-b", imageHash: "hash-b", archived: true }),
    ]);
  });
  afterEach(() => t.close());

  it("archives the selection through the outbox", async () => {
    const { getByTestId, queryByTestId } = await renderGrid(<Grid items={[serverOnly]} />, t.db);
    fireEvent.press(getByTestId("pick-a"));
    fireEvent.press(getByTestId("action-more"));
    fireEvent.press(getByTestId("action-archive"));
    expect(t.db.get(sql`SELECT archived FROM remote_photo WHERE id = 'id-a'`)).toEqual({ archived: 1 });
    expect(outbox().map((r) => r.kind)).toEqual(["archive"]);
    expect(queryByTestId("selection-action-bar")).toBeNull();
  });

  it("unarchives on the Archive grid", async () => {
    const { getByTestId } = await renderGrid(<Grid items={[onBoth]} directions={{ archived: false }} />, t.db);
    fireEvent.press(getByTestId("pick-b"));
    fireEvent.press(getByTestId("action-more"));
    expect(getByTestId("action-archive")).toHaveTextContent("Unarchive");
    fireEvent.press(getByTestId("action-archive"));
    expect(t.db.get(sql`SELECT archived FROM remote_photo WHERE id = 'id-b'`)).toEqual({ archived: 0 });
  });

  it("rates every selected photo, one rating row each", async () => {
    const { getByTestId } = await renderGrid(<Grid items={[serverOnly, onBoth]} />, t.db);
    fireEvent.press(getByTestId("pick-a"));
    fireEvent.press(getByTestId("pick-b"));
    fireEvent.press(getByTestId("action-more"));
    fireEvent.press(getByTestId("action-rate-3"));
    const ratings = t.db.all<{ rating: number }>(sql`SELECT rating FROM remote_photo ORDER BY id`);
    expect(ratings).toEqual([{ rating: 3 }, { rating: 3 }]);
    expect(outbox().map((r) => [r.kind, parsePayload(r.payload)])).toEqual([
      ["rating", { imageHash: "hash-a", rating: 3 }],
      ["rating", { imageHash: "hash-b", rating: 3 }],
    ]);
  });

  it("sets the one selected photo as the album cover", async () => {
    t.db.run(
      sql`INSERT INTO user_album (id, title, owner_id, shared, favorited, cover_hash, photo_count) VALUES (7, 'Trip', 1, 0, 0, NULL, 2)`
    );
    const { getByTestId, queryByTestId } = await renderGrid(<AlbumGrid items={[serverOnly, onBoth]} albumId={7} />, t.db);
    fireEvent.press(getByTestId("pick-a"));
    fireEvent.press(getByTestId("pick-b"));
    fireEvent.press(getByTestId("action-more"));
    expect(queryByTestId("action-set-cover")).toBeNull();
    fireEvent.press(getByTestId("selection-more-sheet-cancel"));
    fireEvent.press(getByTestId("pick-b"));
    fireEvent.press(getByTestId("action-more"));
    fireEvent.press(getByTestId("action-set-cover"));
    expect(t.db.get(sql`SELECT cover_hash FROM user_album WHERE id = 7`)).toEqual({ cover_hash: "hash-a" });
    expect(outbox().map((r) => [r.kind, parsePayload(r.payload)])).toEqual([
      ["album_cover", { albumId: 7, photoId: "id-a", imageHash: "hash-a" }],
    ]);
    expect(messages()).toContain("Cover updated");
  });
});
