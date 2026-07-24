import { fireEvent, waitFor } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { SearchScreen } from "./SearchScreen";
import { renderWithDb, makeMockClient, jsonResponse } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { seedRemotePhotos, remotePhoto } from "@/db/__tests__/fixtures";
import { getRecentSearches, pushRecentSearch } from "@/db/queries/search";

function setOnline(v: boolean) {
  (globalThis as { __mockNetworkConnected?: boolean }).__mockNetworkConnected = v;
}

const SERVER_RESULTS = {
  results: [
    {
      date: "2024-01-01",
      location: "Berlin",
      items: [{ id: "00000000-0000-4000-8000-000000000001", image_hash: "srv-hash", aspectRatio: 1 }],
    },
  ],
};

describe("SearchScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    setOnline(true);
  });
  afterEach(() => {
    t.close();
    setOnline(true);
  });

  it("shows server results when online", async () => {
    const client = makeMockClient(async (url) => {
      if (url.includes("/photos/searchlist/")) return jsonResponse(SERVER_RESULTS);
      return jsonResponse({}, 404);
    });
    const { getByTestId } = renderWithDb(<SearchScreen />, t.db, client);

    fireEvent.changeText(getByTestId("search-input"), "berlin");
    await waitFor(() => expect(getByTestId("search-server-grid")).toBeTruthy());
  });

  it("falls back to offline results when disconnected", async () => {
    setOnline(false);
    seedRemotePhotos(t.db, [remotePhoto({ id: "p1", imageHash: "loc-hash", searchLocation: "Berlin, DE" })]);
    t.db.run(sql`INSERT INTO person (id, name, face_count) VALUES (1, 'Bernard', 4)`);
    const { getByTestId } = renderWithDb(<SearchScreen />, t.db);

    fireEvent.changeText(getByTestId("search-input"), "ber");
    await waitFor(() => {
      expect(getByTestId("search-offline")).toBeTruthy();
      expect(getByTestId("search-offline-photo-loc-hash")).toBeTruthy();
      expect(getByTestId("search-person-1")).toBeTruthy();
    });
  });

  it("shows seeded recent searches and clears them", async () => {
    pushRecentSearch(t.db, "oslo");
    const { getByTestId } = renderWithDb(<SearchScreen />, t.db);

    // Empty query → recent chips render from app_meta.
    await waitFor(() => expect(getByTestId("search-recent-oslo")).toBeTruthy());

    fireEvent.press(getByTestId("search-recent-clear"));
    // The clear write lands in app_meta (reactive re-render needs the live
    // listener, which the test subscribe stubs out — assert the DB instead).
    expect(getRecentSearches(t.db)).toEqual([]);
  });
});
