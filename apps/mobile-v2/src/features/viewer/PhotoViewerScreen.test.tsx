import { fireEvent, waitFor } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { PhotoViewerScreen } from "./PhotoViewerScreen";
import { useSettingsStore } from "@/stores/settings";
import { jsonResponse, makeMockClient, renderWithDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { insertLocalAlbum, insertLocalAsset, remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";
import { putPhotoDetail } from "@/db/queries/detail";
import { notifyOutboxWrite } from "@/sync/triggers";

/**
 * An outbox write kicks a real sync run, which keeps touching the database
 * after the test has closed it. Mocking the trigger keeps the assertion — the
 * mutation must still tell the sync engine there is something to push — without
 * dragging the whole engine into a screen test.
 */
jest.mock("@/sync/triggers", () => ({ notifyOutboxWrite: jest.fn() }));

const PHOTO_ID = "11111111-1111-4111-8111-111111111111";

const PHOTO_DETAIL = {
  id: PHOTO_ID,
  camera: "Pixel 8",
  exif_gps_lat: 52.52,
  exif_gps_lon: 13.405,
  exif_timestamp: "2024-01-03T10:00:00",
  search_captions: null,
  search_location: "Berlin",
  captions_json: {
    user_caption: "Beach day",
    im2txt: "a person on a beach",
    places365: { attributes: ["sunny"], categories: ["beach"] },
  },
  big_thumbnail_url: null,
  small_square_thumbnail_url: null,
  geolocation_json: null,
  exif_json: null,
  people: [
    {
      name: "Ada",
      type: "person",
      probability: 0.95,
      location: { top: 10, bottom: 60, left: 10, right: 60 },
      face_url: "/media/faces/ada.jpg",
      face_id: 7,
    },
  ],
  image_hash: "hashA",
  image_path: ["/data/photos/2024/IMG_0001.JPG"],
  rating: 4,
  hidden: false,
  public: false,
  in_trashcan: false,
  removed: false,
  size: 2_500_000,
  shared_to: [],
  similar_photos: [{ image_hash: "hashB", type: "image" }],
  video: false,
  owner: { id: 1, username: "u", first_name: "", last_name: "" },
  shutter_speed: "1/250",
  height: 3024,
  width: 4032,
  fstop: 1.8,
  iso: 400,
  focal_length: 24,
  focalLength35Equivalent: 27,
  subjectDistance: null,
  digitalZoomRatio: null,
  lens: "Wide",
  embedded_media: [],
};

/** The client every "we are online and the server answers" test uses. */
function onlineClient() {
  return makeMockClient(async (url) => {
    if (url.includes("/photos/hashA/")) return jsonResponse(PHOTO_DETAIL);
    if (url.includes("/site-settings")) return jsonResponse({}, 404);
    return jsonResponse({}, 404);
  });
}

/** Open the info sheet through the chrome's info button. */
function openSheet(utils: { getByTestId: (id: string) => unknown }) {
  fireEvent.press(utils.getByTestId("viewer-info") as never);
}

describe("PhotoViewerScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    useSettingsStore.setState({ serverUrl: "https://test.local" });
    (globalThis as { __mockSearchParams?: unknown }).__mockSearchParams = { id: "hashA" };
    t = createTestDb();
    seedRemotePhotos(t.db, [
      remotePhoto({
        id: PHOTO_ID,
        imageHash: "hashA",
        timestamp: Date.UTC(2024, 0, 3),
        searchLocation: "Berlin",
      }),
    ]);
  });
  afterEach(() => {
    t.close();
    (globalThis as { __mockSearchParams?: unknown }).__mockSearchParams = undefined;
    (globalThis as { __mockNetworkConnected?: unknown }).__mockNetworkConnected = undefined;
  });

  it("opens the pager at the tapped hash from the mirror context", () => {
    const { getByTestId } = renderWithDb(<PhotoViewerScreen />, t.db);
    expect(getByTestId("viewer-pager")).toBeTruthy();
    expect(getByTestId("viewer-image-hashA")).toBeTruthy();
  });

  /**
   * A single tap is the platform gesture for "get the furniture out of my way",
   * not for "show me metadata". The info surface has its own button.
   */
  it("toggles chrome on tap and opens the sheet from the info button", async () => {
    const { getByTestId, queryByTestId } = renderWithDb(<PhotoViewerScreen />, t.db, onlineClient());

    expect(getByTestId("viewer-top-bar")).toBeTruthy();
    expect(queryByTestId("viewer-detail-scroll")).toBeNull();

    fireEvent.press(getByTestId("viewer-image-hashA"));
    expect(queryByTestId("viewer-top-bar")).toBeNull();
    fireEvent.press(getByTestId("viewer-image-hashA"));

    openSheet({ getByTestId });
    await waitFor(() => expect(getByTestId("viewer-detail-scroll")).toBeTruthy());
  });

  describe("the info sheet", () => {
    it("renders EXIF, camera, people, location and similar photos from the detail payload", async () => {
      const utils = renderWithDb(<PhotoViewerScreen />, t.db, onlineClient());
      openSheet(utils);

      await waitFor(() => expect(utils.getByTestId("viewer-camera-name")).toBeTruthy());
      expect(utils.getByText("Pixel 8")).toBeTruthy();
      expect(utils.getByText("ƒ / 1.8 · 1/250 · 24 mm · ISO400")).toBeTruthy();
      expect(utils.getByText("IMG_0001.JPG")).toBeTruthy();
      expect(utils.getByText("4032 × 3024 · 12.2 MP")).toBeTruthy();
      expect(utils.getByText("2.4 MB")).toBeTruthy();
      expect(utils.getByTestId("viewer-person-7")).toBeTruthy();
      expect(utils.getByTestId("viewer-similar-hashB")).toBeTruthy();
      // Scene labels come from the same payload and route into search.
      expect(utils.getByTestId("viewer-attribute-sunny")).toBeTruthy();
      expect(utils.getByTestId("viewer-category-beach")).toBeTruthy();
    });

    it("draws the map preview from the mirror's own coordinates", async () => {
      t.db.run(sql`UPDATE remote_photo SET latitude = 52.52, longitude = 13.405 WHERE id = ${PHOTO_ID}`);
      const utils = renderWithDb(<PhotoViewerScreen />, t.db, onlineClient());
      openSheet(utils);
      await waitFor(() => expect(utils.getByTestId("viewer-map")).toBeTruthy());
      expect(utils.getByTestId("viewer-coordinates")).toBeTruthy();
    });

    /**
     * Album membership is mirrored, so this section is offline-capable even for
     * a photo whose detail payload has never been fetched — better than the web,
     * which spends a request on it (doc 07, capability #52).
     */
    it("lists albums from the mirror with no network at all", async () => {
      t.db.run(
        sql`INSERT INTO user_album (id, title, owner_id, shared, favorited, photo_count) VALUES (3, 'Holiday', 1, 0, 0, 1)`
      );
      t.db.run(sql`INSERT INTO user_album_photo (album_id, photo_id, ordering) VALUES (3, ${PHOTO_ID}, 0)`);
      (globalThis as { __mockNetworkConnected?: unknown }).__mockNetworkConnected = false;

      const utils = renderWithDb(<PhotoViewerScreen />, t.db);
      openSheet(utils);
      await waitFor(() => expect(utils.getByText("Holiday")).toBeTruthy());
      expect(utils.getByTestId("viewer-album-remove-3")).toBeTruthy();
    });

    /**
     * The honest offline state: a photo whose detail payload was never cached
     * must SAY the details are not here, never render a screen of empty rows
     * that reads as "this photo has no camera" (doc 07 §1.3).
     */
    it("explains, rather than blanks, when the detail payload was never cached", async () => {
      const utils = renderWithDb(<PhotoViewerScreen />, t.db);
      openSheet(utils);
      await waitFor(() => expect(utils.getByTestId("viewer-camera-unsynced")).toBeTruthy());
      expect(utils.getByTestId("viewer-file-unsynced")).toBeTruthy();
      expect(utils.getByTestId("viewer-people-unsynced")).toBeTruthy();
      expect(utils.getByTestId("viewer-similar-unsynced")).toBeTruthy();
      // The mirror's own facts are still there.
      expect(utils.getByTestId("viewer-header-place")).toBeTruthy();
    });

    it("renders the cached payload offline and says it is cached", async () => {
      putPhotoDetail(t.db, PHOTO_ID, JSON.stringify(PHOTO_DETAIL), Date.now());
      (globalThis as { __mockNetworkConnected?: unknown }).__mockNetworkConnected = false;

      const utils = renderWithDb(<PhotoViewerScreen />, t.db);
      openSheet(utils);
      await waitFor(() => expect(utils.getByTestId("viewer-from-cache")).toBeTruthy());
      expect(utils.getByText("Pixel 8")).toBeTruthy();
    });

    it("highlights a face on the photo when its person chip is tapped", async () => {
      const utils = renderWithDb(<PhotoViewerScreen />, t.db, onlineClient());
      openSheet(utils);
      await waitFor(() => expect(utils.getByTestId("viewer-person-7")).toBeTruthy());
      expect(utils.queryByTestId("viewer-face-overlay")).toBeNull();
      fireEvent.press(utils.getByTestId("viewer-person-7"));
      await waitFor(() => expect(utils.getByTestId("viewer-face-overlay")).toBeTruthy());
    });
  });

  describe("editing", () => {
    /** The caption is offline-capable, so it must land in the outbox. */
    it("writes a caption edit to the mirror and the outbox", async () => {
      const utils = renderWithDb(<PhotoViewerScreen />, t.db, onlineClient());
      openSheet(utils);
      await waitFor(() => expect(utils.getByTestId("viewer-caption-text")).toBeTruthy());

      fireEvent.press(utils.getByTestId("viewer-caption-edit"));
      fireEvent.changeText(utils.getByTestId("viewer-caption-input"), "Sunset in Berlin");
      fireEvent.press(utils.getByTestId("viewer-caption-save"));

      await waitFor(() => {
        const row = t.db.get(sql`SELECT kind, payload FROM outbox ORDER BY id DESC LIMIT 1`) as
          | { kind: string; payload: string }
          | undefined;
        expect(row?.kind).toBe("caption");
        expect(JSON.parse(row?.payload ?? "{}")).toMatchObject({
          imageHash: "hashA",
          caption: "Sunset in Berlin",
        });
      });
      expect(notifyOutboxWrite).toHaveBeenCalled();
    });

    it("offers the model's caption suggestion from the cached payload", async () => {
      const utils = renderWithDb(<PhotoViewerScreen />, t.db, onlineClient());
      openSheet(utils);
      // Wait for the payload itself, not just for the (always-present) button:
      // the suggestion lives in `captions_json`.
      await waitFor(() => expect(utils.getByTestId("viewer-caption-text")).toBeTruthy());
      fireEvent.press(utils.getByTestId("viewer-caption-edit"));
      expect(utils.getByTestId("viewer-caption-suggestion")).toBeTruthy();
    });

    /**
     * Timestamp edit reorders the timeline, so it is an online-only direct call
     * (doc 07 §4) — and it must say so instead of failing silently.
     */
    it("disables the timestamp edit while offline", async () => {
      (globalThis as { __mockNetworkConnected?: unknown }).__mockNetworkConnected = false;
      const utils = renderWithDb(<PhotoViewerScreen />, t.db);
      openSheet(utils);
      await waitFor(() => expect(utils.getByTestId("viewer-timestamp-edit")).toBeTruthy());
      expect(utils.getByTestId("viewer-timestamp-edit").props.accessibilityState.disabled).toBe(true);
    });

    it("patches the timestamp through the API when online", async () => {
      const seen: string[] = [];
      const client = makeMockClient(async (url, init) => {
        if (url.includes("/photos/edit/hashA/")) {
          seen.push(String(init?.body));
          return jsonResponse({ image_hash: "hashA" });
        }
        if (url.includes("/photos/hashA/")) return jsonResponse(PHOTO_DETAIL);
        return jsonResponse({}, 404);
      });
      const utils = renderWithDb(<PhotoViewerScreen />, t.db, client);
      openSheet(utils);
      await waitFor(() => expect(utils.getByTestId("viewer-timestamp-edit")).toBeTruthy());

      fireEvent.press(utils.getByTestId("viewer-timestamp-edit"));
      fireEvent.changeText(utils.getByTestId("viewer-timestamp-prompt-input"), "2020-05-06 07:08:09");
      fireEvent.press(utils.getByTestId("viewer-timestamp-prompt-submit"));

      await waitFor(() => expect(seen).toHaveLength(1));
      expect(JSON.parse(seen[0])).toEqual({ exif_timestamp: "2020-05-06T07:08:09" });
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

    it("hides server-only affordances and says why", async () => {
      const utils = renderWithDb(<PhotoViewerScreen />, t.db);
      // No server row → no action bar full of no-ops.
      expect(utils.queryByTestId("viewer-action-bar")).toBeNull();
      openSheet(utils);
      await waitFor(() => expect(utils.getByTestId("viewer-local-only")).toBeTruthy());
      // Server-backed sections are replaced by one explanation, not by blanks.
      expect(utils.queryByTestId("viewer-camera-section")).toBeNull();
      expect(utils.queryByTestId("viewer-albums-section")).toBeNull();
    });

    it("still shows the photo's own date from the camera roll", async () => {
      const utils = renderWithDb(<PhotoViewerScreen />, t.db);
      openSheet(utils);
      await waitFor(() => expect(utils.getByTestId("viewer-local-created")).toBeTruthy());
    });
  });
});
