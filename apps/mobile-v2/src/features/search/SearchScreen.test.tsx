import { fireEvent, waitFor } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { SearchScreen } from "./SearchScreen";
import { renderWithDb, makeMockClient, jsonResponse } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { seedRemotePhotos, remotePhoto } from "@/db/__tests__/fixtures";
import { getRecentSearches, pushRecentSearch } from "@/db/queries/search";
import type { AppDatabase } from "@/db/types";

function setOnline(v: boolean) {
  (globalThis as { __mockNetworkConnected?: boolean }).__mockNetworkConnected = v;
}

const router = (globalThis as { __mockRouter?: { push: jest.Mock } }).__mockRouter!;

const SERVER_RESULTS = {
  results: [
    {
      date: "2024-01-01",
      location: "Berlin",
      items: [{ id: "00000000-0000-4000-8000-000000000001", image_hash: "srv-hash", aspectRatio: 1 }],
    },
  ],
};

/** Mirror rows that all match the term "ber". */
function seedBerlin(db: AppDatabase) {
  db.run(sql`INSERT INTO person (id, name, face_count) VALUES (1, 'Bernard', 4)`);
  db.run(sql`INSERT INTO user_album (id, title, photo_count) VALUES (11, 'Berlin trip', 4)`);
  db.run(sql`INSERT INTO place_album (id, title, photo_count) VALUES (12, 'Berlin', 9)`);
  db.run(sql`INSERT INTO thing_album (id, title, photo_count) VALUES (13, 'Bergamot', 2)`);
  db.run(sql`INSERT INTO tag_album (id, title, photo_count) VALUES (14, 'Berry', 1)`);
}

describe("SearchScreen", () => {
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

  it("shows server results when online", async () => {
    const client = makeMockClient(async (url) => {
      if (url.includes("/photos/searchlist/")) return jsonResponse(SERVER_RESULTS);
      return jsonResponse({}, 404);
    });
    const { getByTestId } = renderWithDb(<SearchScreen />, t.db, client);

    fireEvent.changeText(getByTestId("search-input"), "berlin");
    await waitFor(() => expect(getByTestId("search-server-grid")).toBeTruthy());
    expect(getByTestId("search-banner-online")).toHaveTextContent("Results for “berlin”");
  });

  it("groups mirror matches by type next to the online photo results", async () => {
    seedBerlin(t.db);
    const client = makeMockClient(async (url) => {
      if (url.includes("/photos/searchlist/")) return jsonResponse(SERVER_RESULTS);
      return jsonResponse({}, 404);
    });
    const { getByTestId } = renderWithDb(<SearchScreen />, t.db, client);

    fireEvent.changeText(getByTestId("search-input"), "ber");
    await waitFor(() => expect(getByTestId("search-groups")).toBeTruthy());

    expect(getByTestId("search-person-1")).toBeTruthy();
    expect(getByTestId("search-group-albums")).toBeTruthy();
    expect(getByTestId("search-group-places")).toBeTruthy();
    expect(getByTestId("search-group-things")).toBeTruthy();
    expect(getByTestId("search-group-tags")).toBeTruthy();

    fireEvent.press(getByTestId("search-album-place-12"));
    expect(router.push).toHaveBeenCalledWith("/albums/places/12");
  });

  it("falls back to offline results when disconnected, clearly labelled", async () => {
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
    expect(getByTestId("search-banner-offline")).toHaveTextContent(/Offline results/);
    expect(getByTestId("search-banner-offline")).toHaveTextContent(/Connect for full search/);
  });

  it("shows a localized no-results state offline", async () => {
    setOnline(false);
    const { getByTestId } = renderWithDb(<SearchScreen />, t.db);

    fireEvent.changeText(getByTestId("search-input"), "zzzz");
    await waitFor(() => expect(getByTestId("search-offline-empty")).toHaveTextContent("No matches for “zzzz”"));
  });

  it("shows a localized error state with a retry affordance", async () => {
    const client = makeMockClient(async () => jsonResponse({ detail: "boom" }, 500));
    const { getByTestId } = renderWithDb(<SearchScreen />, t.db, client);

    fireEvent.changeText(getByTestId("search-input"), "berlin");
    await waitFor(() => expect(getByTestId("search-server-grid-error")).toBeTruthy());
    expect(getByTestId("search-server-grid-retry")).toBeTruthy();
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

  it("prompts the user when there is nothing typed and no history", async () => {
    const { getByTestId, getByText } = renderWithDb(<SearchScreen />, t.db);

    await waitFor(() => expect(getByTestId("search-intro")).toBeTruthy());
    expect(getByTestId("search-recent-empty")).toBeTruthy();
    expect(getByText("Search your library")).toBeTruthy();
  });

  it("clears the field with the clear button", async () => {
    const { getByTestId, queryByTestId } = renderWithDb(<SearchScreen />, t.db);
    const input = getByTestId("search-input");

    expect(queryByTestId("search-clear")).toBeNull();
    fireEvent.changeText(input, "oslo");
    expect(getByTestId("search-clear")).toBeTruthy();

    fireEvent.press(getByTestId("search-clear"));
    await waitFor(() => expect(getByTestId("search-intro")).toBeTruthy());
    expect(input.props.value).toBe("");
  });

  it("tapping a recent search runs it", async () => {
    setOnline(false);
    pushRecentSearch(t.db, "oslo");
    const { getByTestId } = renderWithDb(<SearchScreen />, t.db);

    fireEvent.press(getByTestId("search-recent-oslo"));
    await waitFor(() => expect(getByTestId("search-offline")).toBeTruthy());
  });
});
