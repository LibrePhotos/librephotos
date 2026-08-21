import { fireEvent, waitFor } from "@testing-library/react-native";
import { SharingScreen } from "./SharingScreen";
import { renderWithDb, makeMockClient, jsonResponse } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";

const OWNER = { id: 2, username: "bob", first_name: "Bob", last_name: "R" };
const SELF = { id: 1, username: "me", first_name: "Me", last_name: "" };

const PIG = (hash: string) => ({
  id: `00000000-0000-4000-8000-0000000000${hash.length.toString().padStart(2, "0")}`,
  image_hash: hash,
  aspectRatio: 1,
});

const ALBUM = {
  id: 7,
  title: "Trip",
  cover_photo: null,
  photo_count: 3,
  owner: OWNER,
  shared_to: [SELF],
  created_on: "2024-01-01",
  favorited: false,
};

function client() {
  return makeMockClient(async (url) => {
    if (url.includes("/photos/shared/fromme/"))
      return jsonResponse({ results: [{ user_id: 2, user: OWNER, photo: PIG("byme1") }] });
    if (url.includes("/photos/shared/tome/")) return jsonResponse({ results: [PIG("withme1")] });
    if (url.includes("/albums/user/shared/fromme/")) return jsonResponse({ results: [ALBUM] });
    if (url.includes("/albums/user/shared/tome/")) return jsonResponse({ results: [ALBUM] });
    return jsonResponse({}, 404);
  });
}

describe("SharingScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    (globalThis as { __mockNetworkConnected?: boolean }).__mockNetworkConnected = true;
  });
  afterEach(() => t.close());

  it("renders shared-by-me photos and albums, and toggles to with-me", async () => {
    const { getByTestId } = renderWithDb(<SharingScreen />, t.db, client());

    await waitFor(() => {
      expect(getByTestId("shared-album-7")).toBeTruthy();
      expect(getByTestId("sharing-grid")).toBeTruthy();
    });

    fireEvent.press(getByTestId("sharing-tab-withMe"));
    await waitFor(() => expect(getByTestId("shared-album-7")).toBeTruthy());
  });
});
