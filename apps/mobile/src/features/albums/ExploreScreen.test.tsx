import { fireEvent } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { ExploreScreen } from "./ExploreScreen";
import { mockRouter, renderWithDb, settleDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@librephotos/local-db/testing";
import { SYNC_ENTITIES, upsertSyncState, type AppDatabase } from "@librephotos/local-db";

function setOnline(v: boolean) {
  globalThis.__mockNetworkConnected = v;
}

const router = mockRouter();

/** Mark every mirrored entity as having finished its first full sync. */
async function markSeeded(db: AppDatabase) {
  for (const entity of SYNC_ENTITIES) {
    await upsertSyncState(db, entity, { last_full_sync: 1_700_000_000_000, status: "idle" });
  }
}

async function seedLibrary(db: AppDatabase) {
  await db.run(
    sql`INSERT INTO user_album (id, title, cover_hash, photo_count, created_on) VALUES (1, 'Trip to Oslo', 'cover-1', 12, 100)`
  );
  await db.run(
    sql`INSERT INTO user_album (id, title, cover_hash, photo_count, created_on) VALUES (2, 'Wedding', NULL, 3, 90)`
  );
  await db.run(sql`INSERT INTO person (id, name, face_count, cover_photo_hash) VALUES (7, 'Bernard', 9, 'face-7')`);
  await db.run(sql`INSERT INTO thing_album (id, title, photo_count, cover_hashes) VALUES (3, 'Bicycle', 5, '["t-3"]')`);
  await db.run(sql`INSERT INTO place_album (id, title, photo_count, cover_hashes) VALUES (4, 'Oslo', 8, '["p-4"]')`);
  await db.run(sql`INSERT INTO tag_album (id, title, photo_count, cover_hashes) VALUES (5, 'Holiday', 2, NULL)`);
  await db.run(sql`INSERT INTO auto_album (id, title, photo_count, cover_hash, timestamp) VALUES (6, 'Summer 2024', 20, 'a-6', 5)`);
}

describe("ExploreScreen", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
    setOnline(true);
    router.push.mockClear();
  });
  afterEach(async () => {
    t.close();
    setOnline(true);
  });

  it("always shows albums, people and folders, and hides empty strips", async () => {
    await markSeeded(t.db);
    const { getByTestId, queryByTestId } = await renderWithDb(<ExploreScreen />, t.db);

    for (const key of ["user", "people", "folders"]) {
      expect(getByTestId(`explore-section-${key}`)).toBeTruthy();
    }
    // Nothing in the mirror: these would only say "No … yet".
    for (const key of ["things", "tags", "places", "events"]) {
      expect(queryByTestId(`explore-section-${key}`)).toBeNull();
    }
  });

  it("shows skeletons for a strip that is still syncing, even when empty", async () => {
    const { getByTestId } = await renderWithDb(<ExploreScreen />, t.db);
    expect(getByTestId("explore-section-things")).toBeTruthy();
  });

  it("opens the library views from the quick tiles and the More list", async () => {
    await markSeeded(t.db);
    const { getByTestId } = await renderWithDb(<ExploreScreen />, t.db);

    expect(getByTestId("collections-quick-favorites")).toBeTruthy();
    fireEvent.press(getByTestId("collections-quick-deleted"));
    await settleDb();
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/albums/library/[filter]", params: { filter: "deleted" } });
    fireEvent.press(getByTestId("collections-more-archived"));
    await settleDb();
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/albums/library/[filter]", params: { filter: "archived" } });
    fireEvent.press(getByTestId("collections-more-sharing"));
    await settleDb();
    expect(router.push).toHaveBeenLastCalledWith("/sharing");
  });

  it("shows live counts and preview cards from the mirror", async () => {
    await markSeeded(t.db);
    await seedLibrary(t.db);
    const { getByTestId, getByText } = await renderWithDb(<ExploreScreen />, t.db);

    expect(getByTestId("explore-count-user")).toHaveTextContent("2 albums");
    expect(getByTestId("explore-count-people")).toHaveTextContent("1 person");
    expect(getByTestId("explore-count-things")).toHaveTextContent("1 album");

    // Preview cards render title + photo count, and a cover when one exists.
    expect(getByTestId("explore-item-user-1")).toBeTruthy();
    expect(getByTestId("explore-cover-user-1")).toBeTruthy();
    expect(getByText("Trip to Oslo")).toBeTruthy();
    expect(getByText("12 photos")).toBeTruthy();
    // …and a placeholder when the album has no cover.
    expect(getByTestId("explore-nocover-user-2")).toBeTruthy();
    expect(getByTestId("explore-item-people-7")).toBeTruthy();
    expect(getByTestId("explore-item-events-6")).toBeTruthy();
  });

  it("shows a per-section empty state once seeding has finished", async () => {
    await markSeeded(t.db);
    const { getByTestId, queryByTestId } = await renderWithDb(<ExploreScreen />, t.db);

    expect(getByTestId("explore-empty-user")).toHaveTextContent("No albums yet");
    expect(getByTestId("explore-empty-people")).toHaveTextContent("No people yet");
    expect(queryByTestId("explore-skeleton-user")).toBeNull();
  });

  it("shows skeletons while the mirror is still seeding", async () => {
    // No sync_state rows at all → the first sync has not completed yet.
    const { getByTestId, queryByTestId } = await renderWithDb(<ExploreScreen />, t.db);

    expect(getByTestId("explore-skeleton-user")).toBeTruthy();
    expect(getByTestId("explore-skeleton-people")).toBeTruthy();
    expect(queryByTestId("explore-empty-user")).toBeNull();
  });

  it("prefers real rows over skeletons for entities that already have data", async () => {
    await seedLibrary(t.db);
    const { getByTestId, queryByTestId } = await renderWithDb(<ExploreScreen />, t.db);

    expect(getByTestId("explore-item-user-1")).toBeTruthy();
    expect(queryByTestId("explore-skeleton-user")).toBeNull();
  });

  it("degrades the online-only Folders row to a notice instead of a broken strip", async () => {
    await markSeeded(t.db);
    const { getByTestId } = await renderWithDb(<ExploreScreen />, t.db);

    expect(getByTestId("explore-notice-folders")).toHaveTextContent("Browse your library the way it is stored on disk.");
  });

  it("navigates to the category screens and to face management", async () => {
    await markSeeded(t.db);
    await seedLibrary(t.db);
    const { getByTestId } = await renderWithDb(<ExploreScreen />, t.db);

    fireEvent.press(getByTestId("explore-viewall-user"));

    await settleDb();
    expect(router.push).toHaveBeenCalledWith("/albums/user/all");

    fireEvent.press(getByTestId("explore-viewall-people"));

    await settleDb();
    expect(router.push).toHaveBeenCalledWith("/albums/people/all");

    fireEvent.press(getByTestId("explore-action-people"));

    await settleDb();
    expect(router.push).toHaveBeenCalledWith("/profile/faces");

    fireEvent.press(getByTestId("explore-item-places-4"));

    await settleDb();
    expect(router.push).toHaveBeenCalledWith("/albums/places/4");
  });

  it("still renders every section while offline (mirror-backed)", async () => {
    setOnline(false);
    await markSeeded(t.db);
    await seedLibrary(t.db);
    const { getByTestId } = await renderWithDb(<ExploreScreen />, t.db);

    expect(getByTestId("explore-item-user-1")).toBeTruthy();
    expect(getByTestId("explore-item-things-3")).toBeTruthy();
  });
});
