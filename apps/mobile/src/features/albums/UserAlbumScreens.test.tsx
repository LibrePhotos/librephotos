import { Alert, type AlertButton } from "react-native";
import { act, fireEvent } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";
import { userAlbumPhotos } from "@/db/queries/albums";
import { DEFAULT_USER_ALBUM_SORT } from "@/lib/albumSort";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useToastStore } from "@/stores/toasts";
import { mockRouter, renderWithDb } from "@/test/test-utils";
import { AlbumDetailScreen } from "./AlbumDetailScreen";
import { MyAlbumsScreen } from "./MyAlbumsScreen";

// The share sheet asks the server who the user is as it mounts; not under test here.
jest.mock("@/features/sharing/ShareSheet", () => ({ ShareSheet: () => null }));
// Outbox writes would kick a sync against the (closed) test DB; replay is tested elsewhere.
jest.mock("@/sync/triggers", () => ({ notifyOutboxWrite: () => undefined }));

const router = mockRouter();
const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

function seed(t: TestDb) {
  seedRemotePhotos(t.db, [
    remotePhoto({ id: "p-old", imageHash: "h-old", timestamp: D(2020, 1, 1) }),
    remotePhoto({ id: "p-new", imageHash: "h-new", timestamp: D(2024, 1, 1) }),
  ]);
  t.db.run(
    sql`INSERT INTO user_album (id, title, owner_id, cover_hash, photo_count, created_on) VALUES
        (1, 'Zoo', 1, NULL, 2, ${D(2024, 5, 1)}),
        (2, 'Alps', 1, 'h-old', 9, ${D(2023, 1, 1)}),
        (3, 'Theirs', 2, NULL, 0, ${D(2022, 1, 1)})`
  );
  t.db.run(
    sql`INSERT INTO user_album_photo (album_id, photo_id, ordering) VALUES (1, 'p-old', 0), (1, 'p-new', 1)`
  );
}

type AlertSpy = jest.SpyInstance<void, Parameters<typeof Alert.alert>>;

/** A JSON outbox payload, as data. */
const parsePayload = (payload: string): unknown => JSON.parse(payload);

/** The image a cover `<Image>` shows (its `source.uri`). */
function coverUri(element: { props: { source?: unknown } }): string | null {
  const source = element.props.source;
  if (typeof source === "object" && source !== null && "uri" in source && typeof source.uri === "string") {
    return source.uri;
  }
  return null;
}

/** The destructive button of the last Alert.alert call. */
function confirmLastAlert(alert: AlertSpy) {
  const buttons: AlertButton[] = alert.mock.calls.at(-1)?.[2] ?? [];
  const confirm = buttons.find((b) => b.style === "destructive");
  act(() => confirm?.onPress?.());
}

describe("My Albums list", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    seed(t);
    useAuthStore.setState({ userId: 1 });
    useToastStore.setState({ toasts: [] });
    useSettingsStore.setState({ albumSort: DEFAULT_USER_ALBUM_SORT });
  });
  afterEach(() => {
    t.close();
    jest.restoreAllMocks();
  });

  /** Render, then let the token check settle (it sets state once it answers). */
  const renderList = async () => {
    const utils = renderWithDb(<MyAlbumsScreen />, t.db);
    await act(async () => {});
    return utils;
  };

  const order = (getAllByTestId: (id: RegExp) => { props: { testID?: string } }[]) =>
    getAllByTestId(/^album-\d+$/).map((el) => el.props.testID);

  it("shows the newest photo as the cover of an album without one", async () => {
    const { getByTestId } = await renderList();
    expect(coverUri(getByTestId("album-cover-1"))).toContain("h-new");
    expect(coverUri(getByTestId("album-cover-2"))).toContain("h-old");
  });

  it("sorts from the header menu and remembers the choice", async () => {
    const { getByTestId, getAllByTestId } = await renderList();
    expect(order(getAllByTestId)).toEqual(["album-1", "album-2", "album-3"]);

    fireEvent.press(getByTestId("albums-sort-button"));
    expect(getByTestId("albums-sort-sheet-created_desc").props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(getByTestId("albums-sort-sheet-name"));

    expect(useSettingsStore.getState().albumSort).toBe("name");
    expect(order(getAllByTestId)).toEqual(["album-2", "album-3", "album-1"]);

    fireEvent.press(getByTestId("albums-sort-button"));
    fireEvent.press(getByTestId("albums-sort-sheet-count_desc"));
    expect(order(getAllByTestId)).toEqual(["album-2", "album-1", "album-3"]);
  });

  it("deletes your album on long-press after asking", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { getByTestId } = await renderList();
    fireEvent(getByTestId("album-1"), "longPress");
    expect(alert).toHaveBeenCalledWith("Delete “Zoo”?", expect.any(String), expect.any(Array));
    // Nothing happens before the confirmation.
    expect(t.db.get(sql`SELECT id FROM user_album WHERE id = 1`)).toEqual({ id: 1 });

    confirmLastAlert(alert);
    expect(t.db.get(sql`SELECT id FROM user_album WHERE id = 1`)).toBeUndefined();
    expect(userAlbumPhotos(t.db, 1)).toEqual([]);
    expect(t.db.all(sql`SELECT kind FROM outbox`)).toEqual([{ kind: "album_delete" }]);
    expect(useToastStore.getState().toasts.map((x) => x.message)).toContain("Album deleted");
  });

  it("does not offer to delete someone else's album", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { getByTestId } = await renderList();
    fireEvent(getByTestId("album-3"), "longPress");
    expect(alert).not.toHaveBeenCalled();
  });
});

describe("Album detail menu", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    seed(t);
    useAuthStore.setState({ userId: 1 });
    useToastStore.setState({ toasts: [] });
    router.replace.mockClear();
    router.back.mockClear();
  });
  afterEach(() => {
    t.close();
    jest.restoreAllMocks();
  });

  /** Render, then let the token and connectivity checks settle (they set state once they answer). */
  const renderAlbum = async (id: number) => {
    const utils = renderWithDb(
      <AlbumDetailScreen title="Album" query={(db) => userAlbumPhotos(db, id)} album={{ id, kind: "user" }} />,
      t.db
    );
    await act(async () => {});
    return utils;
  };

  it("sets the cover from the picker, and goes back to automatic", async () => {
    const { getByTestId } = await renderAlbum(1);
    fireEvent.press(getByTestId("album-menu-button"));
    fireEvent.press(getByTestId("album-menu-cover"));
    expect(getByTestId("album-cover-automatic").props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(getByTestId("album-cover-option-p-old"));

    expect(t.db.get(sql`SELECT cover_hash FROM user_album WHERE id = 1`)).toEqual({ cover_hash: "h-old" });
    fireEvent.press(getByTestId("album-menu-button"));
    fireEvent.press(getByTestId("album-menu-cover"));
    fireEvent.press(getByTestId("album-cover-automatic"));
    expect(t.db.get(sql`SELECT cover_hash FROM user_album WHERE id = 1`)).toEqual({ cover_hash: null });

    const rows = t.db.all<{ kind: string; payload: string }>(sql`SELECT kind, payload FROM outbox ORDER BY id`);
    expect(rows.map((r) => parsePayload(r.payload))).toEqual([
      { albumId: 1, photoId: "p-old", imageHash: "h-old" },
      { albumId: 1, photoId: null, imageHash: null },
    ]);
  });

  it("deletes the album after asking, then leaves the screen", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { getByTestId } = await renderAlbum(1);
    fireEvent.press(getByTestId("album-menu-button"));
    fireEvent.press(getByTestId("album-menu-delete"));
    confirmLastAlert(alert);
    expect(t.db.get(sql`SELECT id FROM user_album WHERE id = 1`)).toBeUndefined();
    expect(router.back).toHaveBeenCalled();
  });

  it("disables rename, cover and delete on someone else's album", async () => {
    const { getByTestId } = await renderAlbum(3);
    fireEvent.press(getByTestId("album-menu-button"));
    for (const key of ["rename", "cover", "delete"]) {
      expect(getByTestId(`album-menu-${key}`).props.accessibilityState).toMatchObject({ disabled: true });
    }
  });
});
