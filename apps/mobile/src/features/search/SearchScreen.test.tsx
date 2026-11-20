import { fireEvent, waitFor } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { SearchScreen } from "./SearchScreen";
import { renderWithDb, makeMockClient, jsonResponse, mockRouter, settleDb } from "@/test/test-utils";
import { createTestDb, remotePhoto, seedRemotePhotos, type TestDb } from "@librephotos/local-db/testing";
import { getRecentSearches, pushRecentSearch, type AppDatabase } from "@librephotos/local-db";

function setOnline(v: boolean) {
  globalThis.__mockNetworkConnected = v;
}

const router = mockRouter();

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
async function seedBerlin(db: AppDatabase) {
  await db.run(sql`INSERT INTO person (id, name, face_count) VALUES (1, 'Bernard', 4)`);
  await db.run(sql`INSERT INTO user_album (id, title, photo_count) VALUES (11, 'Berlin trip', 4)`);
  await db.run(sql`INSERT INTO place_album (id, title, photo_count) VALUES (12, 'Berlin', 9)`);
  await db.run(sql`INSERT INTO thing_album (id, title, photo_count) VALUES (13, 'Bergamot', 2)`);
  await db.run(sql`INSERT INTO tag_album (id, title, photo_count) VALUES (14, 'Berry', 1)`);
}

describe("SearchScreen", () => {
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

  it("shows server results when online", async () => {
    const client = makeMockClient(async (url) => {
      if (url.includes("/photos/searchlist/")) return jsonResponse(SERVER_RESULTS);
      return jsonResponse({}, 404);
    });
    const { getByTestId } = await renderWithDb(<SearchScreen />, t.db, client);

    fireEvent.changeText(getByTestId("search-input"), "berlin");

    await settleDb();
    await waitFor(() => expect(getByTestId("search-server-grid")).toBeTruthy());
    expect(getByTestId("search-banner-online")).toHaveTextContent("Results for “berlin”");
  });

  it("groups mirror matches by type next to the online photo results", async () => {
    await seedBerlin(t.db);
    const client = makeMockClient(async (url) => {
      if (url.includes("/photos/searchlist/")) return jsonResponse(SERVER_RESULTS);
      return jsonResponse({}, 404);
    });
    const { getByTestId } = await renderWithDb(<SearchScreen />, t.db, client);

    fireEvent.changeText(getByTestId("search-input"), "ber");

    await settleDb();
    await waitFor(() => expect(getByTestId("search-groups")).toBeTruthy());

    expect(getByTestId("search-person-1")).toBeTruthy();
    expect(getByTestId("search-group-albums")).toBeTruthy();
    expect(getByTestId("search-group-places")).toBeTruthy();
    expect(getByTestId("search-group-things")).toBeTruthy();
    expect(getByTestId("search-group-tags")).toBeTruthy();

    fireEvent.press(getByTestId("search-album-place-12"));

    await settleDb();
    expect(router.push).toHaveBeenCalledWith("/albums/places/12");
  });

  it("falls back to offline results when disconnected, clearly labelled", async () => {
    setOnline(false);
    await seedRemotePhotos(t.db, [remotePhoto({ id: "p1", imageHash: "loc-hash", searchLocation: "Berlin, DE" })]);
    await t.db.run(sql`INSERT INTO person (id, name, face_count) VALUES (1, 'Bernard', 4)`);
    const { getByTestId } = await renderWithDb(<SearchScreen />, t.db);

    fireEvent.changeText(getByTestId("search-input"), "ber");

    await settleDb();
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
    const { getByTestId } = await renderWithDb(<SearchScreen />, t.db);

    fireEvent.changeText(getByTestId("search-input"), "zzzz");

    await settleDb();
    await waitFor(() => expect(getByTestId("search-offline-empty")).toHaveTextContent("No matches for “zzzz”"));
  });

  it("shows a localized error state with a retry affordance", async () => {
    const client = makeMockClient(async () => jsonResponse({ detail: "boom" }, 500));
    const { getByTestId } = await renderWithDb(<SearchScreen />, t.db, client);

    fireEvent.changeText(getByTestId("search-input"), "berlin");

    await settleDb();
    await waitFor(() => expect(getByTestId("search-server-grid-error")).toBeTruthy());
    expect(getByTestId("search-server-grid-retry")).toBeTruthy();
  });

  it("shows seeded recent searches and clears them", async () => {
    await pushRecentSearch(t.db, "oslo");
    const { getByTestId } = await renderWithDb(<SearchScreen />, t.db);

    // Empty query → recent chips render from app_meta.
    await waitFor(() => expect(getByTestId("search-recent-oslo")).toBeTruthy());

    fireEvent.press(getByTestId("search-recent-clear"));

    await settleDb();
    // The clear write lands in app_meta (reactive re-render needs the live
    // listener, which the test subscribe stubs out — assert the DB instead).
    expect(await getRecentSearches(t.db)).toEqual([]);
  });

  it("prompts the user when there is nothing typed and no history", async () => {
    const { getByTestId, getByText } = await renderWithDb(<SearchScreen />, t.db);

    await waitFor(() => expect(getByTestId("search-intro")).toBeTruthy());
    expect(getByTestId("search-recent-empty")).toBeTruthy();
    expect(getByText("Search your library")).toBeTruthy();
  });

  it("clears the field with the clear button", async () => {
    const { getByTestId, queryByTestId } = await renderWithDb(<SearchScreen />, t.db);
    const input = getByTestId("search-input");

    expect(queryByTestId("search-clear")).toBeNull();
    fireEvent.changeText(input, "oslo");
    await settleDb();
    expect(getByTestId("search-clear")).toBeTruthy();

    fireEvent.press(getByTestId("search-clear"));

    await settleDb();
    await waitFor(() => expect(getByTestId("search-intro")).toBeTruthy());
    expect(input.props.value).toBe("");
  });

  describe("?q= route param (viewer scene-tag and person links)", () => {
    afterEach(async () => {
      globalThis.__mockSearchParams = undefined;
    });

    it("opens with the linked term in the field and runs it", async () => {
      globalThis.__mockSearchParams = { q: "berlin" };
      const searched: string[] = [];
      const client = makeMockClient(async (url) => {
        if (url.includes("/photos/searchlist/")) {
          searched.push(decodeURIComponent(/[?&]search=([^&]*)/.exec(url)?.[1] ?? ""));
          return jsonResponse(SERVER_RESULTS);
        }
        return jsonResponse({}, 404);
      });
      const { getByTestId } = await renderWithDb(<SearchScreen />, t.db, client);

      expect(getByTestId("search-input").props.value).toBe("berlin");
      await waitFor(() => expect(getByTestId("search-server-grid")).toBeTruthy());
      expect(getByTestId("search-banner-online")).toHaveTextContent("Results for “berlin”");
      expect(searched).toContain("berlin");
    });

    it("replaces the term when a later link carries a different q", async () => {
      setOnline(false);
      await seedRemotePhotos(t.db, [remotePhoto({ id: "p1", imageHash: "oslo-hash", searchLocation: "Oslo, NO" })]);
      globalThis.__mockSearchParams = { q: "zzzz" };
      const { getByTestId, rerender } = await renderWithDb(<SearchScreen />, t.db);
      await waitFor(() => expect(getByTestId("search-offline-empty")).toHaveTextContent("No matches for “zzzz”"));

      globalThis.__mockSearchParams = { q: "oslo" };
      rerender(<SearchScreen />);

      expect(getByTestId("search-input").props.value).toBe("oslo");
      await waitFor(() => expect(getByTestId("search-offline-photo-oslo-hash")).toBeTruthy());
    });

    it("keeps what the user typed while q stays the same", async () => {
      setOnline(false);
      globalThis.__mockSearchParams = { q: "berlin" };
      const { getByTestId, rerender } = await renderWithDb(<SearchScreen />, t.db);

      fireEvent.changeText(getByTestId("search-input"), "oslo");

      await settleDb();
      rerender(<SearchScreen />);
      expect(getByTestId("search-input").props.value).toBe("oslo");
    });
  });

  it("tapping a recent search runs it", async () => {
    setOnline(false);
    await pushRecentSearch(t.db, "oslo");
    const { getByTestId } = await renderWithDb(<SearchScreen />, t.db);

    fireEvent.press(getByTestId("search-recent-oslo"));

    await settleDb();
    await waitFor(() => expect(getByTestId("search-offline")).toBeTruthy());
  });
});
