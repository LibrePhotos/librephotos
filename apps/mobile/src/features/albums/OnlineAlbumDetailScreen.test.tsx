import { waitFor } from "@testing-library/react-native";
import { OnlineAlbumDetailScreen } from "./OnlineAlbumDetailScreen";
import { renderWithDb, makeMockClient, jsonResponse } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";

const ALBUM = {
  results: {
    id: "5",
    title: "Dog",
    grouped_photos: [
      {
        date: "2024-01-01",
        location: null,
        items: [
          { id: "00000000-0000-4000-8000-000000000001", image_hash: "hash-a", aspectRatio: 1 },
          { id: "00000000-0000-4000-8000-000000000002", image_hash: "hash-b", aspectRatio: 1 },
        ],
      },
    ],
  },
};

describe("OnlineAlbumDetailScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    (globalThis as { __mockNetworkConnected?: boolean }).__mockNetworkConnected = true;
  });
  afterEach(() => {
    t.close();
    (globalThis as { __mockNetworkConnected?: boolean }).__mockNetworkConnected = true;
  });

  it("renders the online photo grid for a thing album", async () => {
    const client = makeMockClient(async (url) => {
      if (url.includes("/albums/thing/5/")) return jsonResponse(ALBUM);
      return jsonResponse({}, 404);
    });
    const { getByTestId } = renderWithDb(<OnlineAlbumDetailScreen kind="thing" id="5" />, t.db, client);

    await waitFor(() => {
      expect(getByTestId("album-detail-title").props.children).toBe("Dog");
      expect(getByTestId("album-detail-grid")).toBeTruthy();
    });
  });

  it("shows an offline state when disconnected with no data", async () => {
    (globalThis as { __mockNetworkConnected?: boolean }).__mockNetworkConnected = false;
    const client = makeMockClient(async () => jsonResponse({}, 500));
    const { getByTestId } = renderWithDb(<OnlineAlbumDetailScreen kind="thing" id="5" />, t.db, client);

    await waitFor(() => expect(getByTestId("album-detail-grid-offline")).toBeTruthy());
  });
});
