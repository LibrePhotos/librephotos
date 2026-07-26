import { fireEvent, waitFor } from "@testing-library/react-native";
import { PhotoViewerScreen } from "./PhotoViewerScreen";
import { useSettingsStore } from "@/stores/settings";
import { jsonResponse, makeMockClient, renderWithDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { insertLocalAlbum, insertLocalAsset, remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";

const PHOTO_DETAIL = {
  id: "11111111-1111-4111-8111-111111111111",
  camera: "Pixel 8",
  exif_gps_lat: null,
  exif_gps_lon: null,
  exif_timestamp: "2024-01-03T10:00:00",
  search_captions: null,
  search_location: "Berlin",
  captions_json: null,
  big_thumbnail_url: null,
  small_square_thumbnail_url: null,
  geolocation_json: null,
  exif_json: null,
  people: [],
  image_hash: "hashA",
  image_path: [],
  rating: 4,
  hidden: false,
  public: false,
  in_trashcan: false,
  removed: false,
  size: 1000,
  shared_to: [],
  similar_photos: [],
  video: false,
  owner: { id: 1, username: "u", first_name: "", last_name: "" },
  shutter_speed: null,
  height: 100,
  width: 100,
  fstop: null,
  iso: null,
  focal_length: null,
  focalLength35Equivalent: null,
  subjectDistance: null,
  digitalZoomRatio: null,
  lens: null,
  embedded_media: [],
};

describe("PhotoViewerScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    useSettingsStore.setState({ serverUrl: "https://test.local" });
    (globalThis as { __mockSearchParams?: unknown }).__mockSearchParams = { id: "hashA" };
    t = createTestDb();
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "11111111-1111-4111-8111-111111111111", imageHash: "hashA", timestamp: Date.UTC(2024, 0, 3) }),
    ]);
  });
  afterEach(() => {
    t.close();
    (globalThis as { __mockSearchParams?: unknown }).__mockSearchParams = undefined;
  });

  it("opens the pager at the tapped hash from the mirror context", () => {
    const { getByTestId } = renderWithDb(<PhotoViewerScreen />, t.db);
    expect(getByTestId("viewer-pager")).toBeTruthy();
    expect(getByTestId("viewer-image-hashA")).toBeTruthy();
  });

  it("toggles the detail sheet and fetches detail (cache-then-network)", async () => {
    const client = makeMockClient(async (url) => {
      if (url.includes("/photos/hashA/")) return jsonResponse(PHOTO_DETAIL);
      return jsonResponse({}, 404);
    });
    const { getByTestId, queryByTestId } = renderWithDb(<PhotoViewerScreen />, t.db, client);

    expect(queryByTestId("viewer-detail-sheet")).toBeNull();
    fireEvent.press(getByTestId("viewer-image-hashA"));
    await waitFor(() => {
      expect(getByTestId("viewer-detail-sheet")).toBeTruthy();
    });
  });

  /**
   * Device-run report: "Lightbox does not seem to be implemented". It was — but
   * every caller guarded with `if (item.imageHash)`, and a camera-roll asset
   * has no image hash until it is hashed, so tapping one did nothing at all.
   */
  describe("local-only camera-roll assets", () => {
    beforeEach(() => {
      insertLocalAsset(t.db, { id: "L1", hash: null, uri: "ph://L1" });
      insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["L1"] });
      (globalThis as { __mockSearchParams?: unknown }).__mockSearchParams = { id: "L1" };
    });

    it("opens by local asset id and renders from the camera-roll uri", () => {
      const { getByTestId } = renderWithDb(<PhotoViewerScreen />, t.db);
      const image = getByTestId("viewer-image-L1");
      expect(image).toBeTruthy();
      expect(image.props.source).toEqual({ uri: "ph://L1" });
    });

    it("hides server-only affordances and says why", () => {
      const { getByTestId, queryByTestId } = renderWithDb(<PhotoViewerScreen />, t.db);
      // No server row → no action bar full of no-ops.
      expect(queryByTestId("viewer-action-bar")).toBeNull();
      fireEvent.press(getByTestId("viewer-image-L1"));
      expect(getByTestId("viewer-local-only")).toBeTruthy();
    });
  });
});
