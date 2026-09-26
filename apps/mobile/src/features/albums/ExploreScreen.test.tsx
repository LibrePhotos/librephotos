import { fireEvent } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { ExploreScreen } from "./ExploreScreen";
import { renderWithDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import type { AppDatabase } from "@/db/types";
import { upsertSyncState, SYNC_ENTITIES } from "@/db/queries/sync-state";

function setOnline(v: boolean) {
  (globalThis as { __mockNetworkConnected?: boolean }).__mockNetworkConnected = v;
}

const router = (globalThis as { __mockRouter?: { push: jest.Mock } }).__mockRouter!;

/** Mark every mirrored entity as having finished its first full sync. */
function markSeeded(db: AppDatabase) {
  for (const entity of SYNC_ENTITIES) {
    upsertSyncState(db, entity, { last_full_sync: 1_700_000_000_000, status: "idle" });
  }
}

function seedLibrary(db: AppDatabase) {
  db.run(
    sql`INSERT INTO user_album (id, title, cover_hash, photo_count, created_on) VALUES (1, 'Trip to Oslo', 'cover-1', 12, 100)`
  );
  db.run(
    sql`INSERT INTO user_album (id, title, cover_hash, photo_count, created_on) VALUES (2, 'Wedding', NULL, 3, 90)`
  );
  db.run(sql`INSERT INTO person (id, name, face_count, cover_photo_hash) VALUES (7, 'Bernard', 9, 'face-7')`);
  db.run(sql`INSERT INTO thing_album (id, title, photo_count, cover_hashes) VALUES (3, 'Bicycle', 5, '["t-3"]')`);
  db.run(sql`INSERT INTO place_album (id, title, photo_count, cover_hashes) VALUES (4, 'Oslo', 8, '["p-4"]')`);
  db.run(sql`INSERT INTO tag_album (id, title, photo_count, cover_hashes) VALUES (5, 'Holiday', 2, NULL)`);
  db.run(sql`INSERT INTO auto_album (id, title, photo_count, cover_hash, timestamp) VALUES (6, 'Summer 2024', 20, 'a-6', 5)`);
}

describe("ExploreScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    setOnline(true);
    router.push.mockClear();
  });
  afterEach(() => {
    t.close();
    setOnline(true);
  });

  it("renders every category section", () => {
    markSeeded(t.db);
    const { getByTestId } = renderWithDb(<ExploreScreen />, t.db);

    for (const key of ["user", "people", "things", "tags", "places", "events", "folders"]) {
      expect(getByTestId(`explore-section-${key}`)).toBeTruthy();
    }
  });

  it("shows live counts and preview cards from the mirror", () => {
    markSeeded(t.db);
    seedLibrary(t.db);
    const { getByTestId, getByText } = renderWithDb(<ExploreScreen />, t.db);

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

  it("shows a per-section empty state once seeding has finished", () => {
    markSeeded(t.db);
    const { getByTestId, queryByTestId } = renderWithDb(<ExploreScreen />, t.db);

    expect(getByTestId("explore-empty-user")).toHaveTextContent("No albums yet");
    expect(getByTestId("explore-empty-people")).toHaveTextContent("No people yet");
    expect(queryByTestId("explore-skeleton-user")).toBeNull();
  });

  it("shows skeletons while the mirror is still seeding", () => {
    // No sync_state rows at all → the first sync has not completed yet.
    const { getByTestId, queryByTestId } = renderWithDb(<ExploreScreen />, t.db);

    expect(getByTestId("explore-skeleton-user")).toBeTruthy();
    expect(getByTestId("explore-skeleton-people")).toBeTruthy();
    expect(queryByTestId("explore-empty-user")).toBeNull();
  });

  it("prefers real rows over skeletons for entities that already have data", () => {
    seedLibrary(t.db); // rows present, sync_state still empty
    const { getByTestId, queryByTestId } = renderWithDb(<ExploreScreen />, t.db);

    expect(getByTestId("explore-item-user-1")).toBeTruthy();
    expect(queryByTestId("explore-skeleton-user")).toBeNull();
  });

  it("degrades the online-only Folders row to a notice instead of a broken strip", () => {
    markSeeded(t.db);
    const { getByTestId } = renderWithDb(<ExploreScreen />, t.db);

    expect(getByTestId("explore-notice-folders")).toHaveTextContent("Browse your library the way it is stored on disk.");
  });

  it("navigates to the category screens and to face management", () => {
    markSeeded(t.db);
    seedLibrary(t.db);
    const { getByTestId } = renderWithDb(<ExploreScreen />, t.db);

    fireEvent.press(getByTestId("explore-viewall-user"));
    expect(router.push).toHaveBeenCalledWith("/albums/user/all");

    fireEvent.press(getByTestId("explore-viewall-people"));
    expect(router.push).toHaveBeenCalledWith("/albums/people/all");

    fireEvent.press(getByTestId("explore-action-people"));
    expect(router.push).toHaveBeenCalledWith("/profile/faces");

    fireEvent.press(getByTestId("explore-item-places-4"));
    expect(router.push).toHaveBeenCalledWith("/albums/places/4");
  });

  it("still renders every section while offline (mirror-backed)", () => {
    setOnline(false);
    markSeeded(t.db);
    seedLibrary(t.db);
    const { getByTestId } = renderWithDb(<ExploreScreen />, t.db);

    expect(getByTestId("explore-item-user-1")).toBeTruthy();
    expect(getByTestId("explore-item-things-3")).toBeTruthy();
  });
});
