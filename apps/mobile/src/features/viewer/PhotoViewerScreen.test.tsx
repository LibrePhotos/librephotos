import { fireEvent, waitFor, type RenderResult } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { PhotoViewerScreen } from "./PhotoViewerScreen";
import { useSettingsStore } from "@/stores/settings";
import { jsonResponse, makeMockClient, renderWithDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { insertLocalAlbum, insertLocalAsset, remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";
import { putPhotoDetail } from "@/db/queries/detail";
import { notifyOutboxWrite } from "@/sync/triggers";
import { Alert, Dimensions, type AlertButton } from "react-native";
import * as Sharing from "expo-sharing";
import { containedRect } from "./FaceOverlay";
import { useImagePixelSize } from "./useImagePixelSize";

/**
 * An outbox write kicks a real sync run, which keeps touching the database
 * after the test has closed it. Mocking the trigger keeps the assertion — the
 * mutation must still tell the sync engine there is something to push — without
 * dragging the whole engine into a screen test.
 */
jest.mock("@/sync/triggers", () => ({ notifyOutboxWrite: jest.fn<void, unknown[]>() }));

/** A server-side edit pulls the edited row into the mirror; the engine itself is not under test here. */
jest.mock("@/sync/run", () => ({ runSync: jest.fn(async () => null) }));

type DownloadResult = { uri: string; status: number; headers: Record<string, string>; mimeType: string | null };
// `mock`-prefixed so jest's hoisted factory may reference it.
const mockDownloadAsync = jest.fn<Promise<DownloadResult>, [url: string, dest: string]>(async (_url, dest) => ({
  uri: dest,
  status: 200,
  headers: {},
  mimeType: "image/jpeg",
}));
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  downloadAsync: (url: string, dest: string) => mockDownloadAsync(url, dest),
  moveAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  makeDirectoryAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: false })),
}));

/** Press the button of an `Alert.alert` the screen raised, by its label. */
function pressAlertButton(spy: jest.SpyInstance<void, Parameters<typeof Alert.alert>>, label: string) {
  const buttons: AlertButton[] = spy.mock.lastCall?.[2] ?? [];
  const button = buttons.find((b) => b.text === label);
  expect(button).toBeTruthy();
  button?.onPress?.();
}

/** The last outbox row, its payload parsed. */
function lastOutbox(t: TestDb): { kind: string; payload: unknown } | null {
  const row = t.db.get(sql`SELECT kind, payload FROM outbox ORDER BY id DESC LIMIT 1`) as
    | { kind: string; payload: string }
    | undefined;
  return row ? { kind: row.kind, payload: JSON.parse(row.payload) as unknown } : null;
}

/** The address an image slide asks for. */
function imageUri(utils: Pick<RenderResult, "getByTestId">, testID: string): string {
  const source: unknown = utils.getByTestId(testID).props.source;
  return typeof source === "object" && source !== null && "uri" in source ? String(source.uri) : "";
}

/**
 * The big thumbnail of a 4032x3024 photo at the default BIG_THUMBNAIL_HEIGHT;
 * expo-image decodes it natively, so its loaded size is stubbed here.
 */
jest.mock("./useImagePixelSize", () => ({
  useImagePixelSize: jest.fn(() => ({ width: 1440, height: 1080 })),
}));

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
  big_thumbnail_url: "",
  small_square_thumbnail_url: "",
  geolocation_json: null,
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
    if (url.includes("/sitesettings")) return jsonResponse({}, 404);
    return jsonResponse({}, 404);
  });
}

/** Open the info sheet through the chrome's info button. */
function openSheet(utils: Pick<RenderResult, "getByTestId">) {
  fireEvent.press(utils.getByTestId("viewer-info"));
}

describe("PhotoViewerScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    useSettingsStore.setState({ serverUrl: "https://test.local" });
    globalThis.__mockSearchParams = { id: "hashA" };
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
    globalThis.__mockSearchParams = undefined;
    globalThis.__mockNetworkConnected = undefined;
  });

  it("opens the pager at the tapped hash from the mirror context", () => {
    const { getByTestId } = renderWithDb(<PhotoViewerScreen />, t.db);
    expect(getByTestId("viewer-pager")).toBeTruthy();
    expect(getByTestId("viewer-image-hashA")).toBeTruthy();
  });

  /**
   * Device report: "clicking on a photo to open up a lightbox takes a while.
   * this should be instant." The first frame must not depend on the database at
   * all — the grid hands over the slide it was already drawing.
   */
  describe("first paint", () => {
    it("paints the tapped photo from the route params with an empty mirror", () => {
      const empty = createTestDb();
      try {
        globalThis.__mockSearchParams = {
          id: "L9",
          su: "ph://L9",
          sl: "L9",
          st: "image",
        };
        const { getByTestId } = renderWithDb(<PhotoViewerScreen />, empty.db);
        expect(getByTestId("viewer-image-L9").props.source).toEqual({ uri: "ph://L9" });
      } finally {
        empty.close();
      }
    });

    /**
     * The pager used to materialise 500 slides — 500 rows out of a whole-library
     * sort, and 500 filmstrip tiles — before it could show one photo. It now
     * loads a window around the tapped photo and grows it on demand.
     */
    it("loads a window around the tapped photo, not the whole timeline", () => {
      const many = createTestDb();
      try {
        seedRemotePhotos(
          many.db,
          Array.from({ length: 200 }, (_, i) =>
            remotePhoto({
              id: `p${String(i).padStart(3, "0")}`,
              imageHash: `wh${i}`,
              timestamp: Date.UTC(2024, 0, 1) + i * 86_400_000,
            })
          )
        );
        globalThis.__mockSearchParams = { id: "wh100" };
        const { getByTestId, queryByTestId } = renderWithDb(<PhotoViewerScreen />, many.db);

        expect(getByTestId("viewer-filmstrip-p100")).toBeTruthy();
        expect(getByTestId("viewer-filmstrip-p120")).toBeTruthy(); // window edge
        expect(getByTestId("viewer-filmstrip-p080")).toBeTruthy();
        // …and not the rest of the library.
        expect(queryByTestId("viewer-filmstrip-p199")).toBeNull();
        expect(queryByTestId("viewer-filmstrip-p000")).toBeNull();
      } finally {
        many.close();
      }
    });
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
      globalThis.__mockNetworkConnected = false;

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
      globalThis.__mockNetworkConnected = false;

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

  /**
   * #2577: face boxes come in pixels of the big thumbnail (1440x1080 for a
   * 4032x3024 photo at the default BIG_THUMBNAIL_HEIGHT), not of the original.
   * Divided by the original's size, a face in the middle was drawn near the
   * top-left corner.
   */
  it("places a face box by the big thumbnail it was found on", async () => {
    const middleFace = { top: 405, bottom: 675, left: 540, right: 900 };
    const client = makeMockClient(async (url) => {
      if (url.includes("/photos/hashA/")) {
        return jsonResponse({
          ...PHOTO_DETAIL,
          people: [{ ...PHOTO_DETAIL.people[0], location: middleFace }],
        });
      }
      return jsonResponse({}, 404);
    });
    const utils = renderWithDb(<PhotoViewerScreen />, t.db, client);
    openSheet(utils);
    await waitFor(() => expect(utils.getByTestId("viewer-person-7")).toBeTruthy());
    fireEvent.press(utils.getByTestId("viewer-person-7"));
    await waitFor(() => expect(utils.getByTestId("viewer-face-overlay")).toBeTruthy());

    const window = Dimensions.get("window");
    const image = containedRect(1440, 1080, window.width, window.height);
    const overlay = utils.getByTestId("viewer-face-overlay");
    expect(image).not.toBeNull();
    if (!image) return;
    // Measured on the big thumbnail, not on the original.
    const faceSpace = jest.mocked(useImagePixelSize).mock.lastCall?.[0];
    expect(faceSpace?.uri).toContain("/media/thumbnails_big/hashA");
    // The middle quarter of the picture, wherever the slide letterboxes it.
    expect(overlay.props.style).toHaveProperty("left", image.left + image.width * 0.375);
    expect(overlay.props.style).toHaveProperty("top", image.top + image.height * 0.375);
    expect(overlay.props.style).toHaveProperty("width", image.width * 0.25);
    expect(overlay.props.style).toHaveProperty("height", image.height * 0.25);
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
      globalThis.__mockNetworkConnected = false;
      const utils = renderWithDb(<PhotoViewerScreen />, t.db);
      openSheet(utils);
      await waitFor(() => expect(utils.getByTestId("viewer-timestamp-edit")).toBeTruthy());
      expect(utils.getByTestId("viewer-timestamp-edit").props.accessibilityState).toHaveProperty("disabled", true);
    });

    /** The free-text prompt is gone: the date and time come from the platform picker. */
    it("patches the timestamp picked in the date-and-time picker", async () => {
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
      fireEvent(
        utils.getByTestId("viewer-timestamp-picker-wheel"),
        "onValueChange",
        { type: "set", nativeEvent: { timestamp: 0, utcOffset: 0 } },
        new Date(2020, 4, 6, 7, 8, 9)
      );
      fireEvent.press(utils.getByTestId("viewer-timestamp-picker-save"));

      await waitFor(() => expect(seen).toHaveLength(1));
      expect(JSON.parse(seen[0])).toEqual({ exif_timestamp: "2020-05-06T07:08:09" });
    });
  });

  describe("the action bar and its sheets", () => {
    beforeEach(() => {
      mockDownloadAsync.mockClear();
      jest.mocked(Sharing.shareAsync).mockClear();
    });

    it("shares a server original through the system share sheet", async () => {
      const utils = renderWithDb(<PhotoViewerScreen />, t.db, onlineClient());
      fireEvent.press(utils.getByTestId("viewer-share"));
      await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
      expect(mockDownloadAsync.mock.lastCall?.[0]).toContain("/media/photos/hashA");
      const [uri, options] = jest.mocked(Sharing.shareAsync).mock.lastCall ?? [];
      expect(uri).toMatch(/^file:\/\/\/cache\/share\/.+\.jpg$/);
      expect(options).toMatchObject({ mimeType: "image/jpeg" });
    });

    /** The phone already has the file: nothing to download, and it works offline. */
    it("shares the phone's own copy without the server", async () => {
      insertLocalAsset(t.db, { id: "L7", hash: "hashA", uri: "file:///dcim/IMG_0001.jpg" });
      insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["L7"] });
      globalThis.__mockNetworkConnected = false;
      const utils = renderWithDb(<PhotoViewerScreen />, t.db);
      fireEvent.press(utils.getByTestId("viewer-share"));
      await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
      expect(jest.mocked(Sharing.shareAsync).mock.lastCall?.[0]).toBe("file:///dcim/IMG_0001.jpg");
      expect(mockDownloadAsync).not.toHaveBeenCalled();
    });

    /** Archive has a mirror column and a bulk endpoint, so it rides the outbox like hide. */
    it("archives through the outbox from the more sheet, offline too", async () => {
      globalThis.__mockNetworkConnected = false;
      const utils = renderWithDb(<PhotoViewerScreen />, t.db);
      fireEvent.press(utils.getByTestId("viewer-more"));
      fireEvent.press(utils.getByTestId("viewer-menu-archive"));

      expect(lastOutbox(t)).toEqual({ kind: "archive", payload: { imageHashes: ["hashA"], archived: true } });
      expect(t.db.get(sql`SELECT archived FROM remote_photo WHERE id = ${PHOTO_ID}`)).toEqual({ archived: 1 });
      expect(notifyOutboxWrite).toHaveBeenCalled();
      // The sheet closed itself.
      expect(utils.queryByTestId("viewer-more-sheet")).toBeNull();
    });

    it("rates from the more sheet", () => {
      const utils = renderWithDb(<PhotoViewerScreen />, t.db);
      fireEvent.press(utils.getByTestId("viewer-more"));
      fireEvent.press(utils.getByTestId("viewer-star-3"));
      expect(lastOutbox(t)).toEqual({ kind: "rating", payload: { imageHash: "hashA", rating: 3 } });
    });

    /** The server turns the photo; the viewer asks for its thumbnail anew instead of the cached one. */
    it("rotates on the server and re-fetches the image", async () => {
      const bodies: string[] = [];
      const client = makeMockClient(async (url, init) => {
        if (url.includes("/photosedit/rotate/")) {
          bodies.push(String(init?.body));
          return jsonResponse({ status: true, image_hash: "hashA", local_orientation: 8, last_modified: "2024-01-03T10:00:00Z" });
        }
        if (url.includes("/photos/hashA/")) return jsonResponse(PHOTO_DETAIL);
        return jsonResponse({}, 404);
      });
      const utils = renderWithDb(<PhotoViewerScreen />, t.db, client);
      expect(imageUri(utils, "viewer-image-hashA")).not.toContain("v=");

      fireEvent.press(utils.getByTestId("viewer-edit"));
      fireEvent.press(utils.getByTestId("viewer-menu-rotate-right"));

      await waitFor(() => expect(bodies).toHaveLength(1));
      // Clockwise is a negative angle for the server (#2595).
      expect(JSON.parse(bodies[0])).toEqual({ image_hash: "hashA", angle: -90 });
      await waitFor(() => expect(imageUri(utils, "viewer-image-hashA")).toMatch(/\?v=\d+$/));
    });

    it("sets the location to a place found by name", async () => {
      const patches: string[] = [];
      const client = makeMockClient(async (url, init) => {
        if (url.includes("/geocode/search")) {
          return jsonResponse([{ display_name: "Lisbon, Portugal", lat: 38.72, lon: -9.14 }]);
        }
        if (url.includes("/photos/edit/hashA/")) {
          patches.push(String(init?.body));
          return jsonResponse({ image_hash: "hashA", geocoded: true });
        }
        if (url.includes("/photos/hashA/")) return jsonResponse(PHOTO_DETAIL);
        return jsonResponse({}, 404);
      });
      const utils = renderWithDb(<PhotoViewerScreen />, t.db, client);
      openSheet(utils);
      await waitFor(() => expect(utils.getByTestId("viewer-location-edit")).toBeTruthy());
      fireEvent.press(utils.getByTestId("viewer-location-edit"));
      fireEvent.changeText(utils.getByTestId("viewer-location-search"), "Lisbon");

      await waitFor(() => expect(utils.getByTestId("viewer-location-result-0")).toBeTruthy());
      fireEvent.press(utils.getByTestId("viewer-location-result-0"));

      await waitFor(() => expect(patches).toHaveLength(1));
      expect(JSON.parse(patches[0])).toEqual({ exif_gps_lat: 38.72, exif_gps_lon: -9.14 });
    });

    it("removes the location after asking", async () => {
      t.db.run(sql`UPDATE remote_photo SET latitude = 52.52, longitude = 13.405 WHERE id = ${PHOTO_ID}`);
      const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
      const patches: string[] = [];
      const client = makeMockClient(async (url, init) => {
        if (url.includes("/photos/edit/hashA/")) {
          patches.push(String(init?.body));
          return jsonResponse({ image_hash: "hashA" });
        }
        if (url.includes("/photos/hashA/")) return jsonResponse(PHOTO_DETAIL);
        return jsonResponse({}, 404);
      });
      try {
        const utils = renderWithDb(<PhotoViewerScreen />, t.db, client);
        fireEvent.press(utils.getByTestId("viewer-edit"));
        fireEvent.press(utils.getByTestId("viewer-menu-location"));
        fireEvent.press(utils.getByTestId("viewer-location-remove"));
        expect(patches).toHaveLength(0);
        pressAlertButton(alert, "Remove location");

        await waitFor(() => expect(patches).toHaveLength(1));
        expect(JSON.parse(patches[0])).toEqual({ exif_gps_lat: null, exif_gps_lon: null });
      } finally {
        alert.mockRestore();
      }
    });

    it("shows the photo's tags and adds one", async () => {
      const posts: { url: string; body: string }[] = [];
      const client = makeMockClient(async (url, init) => {
        if (init?.method === "POST" && url.includes("/tags/")) {
          posts.push({ url, body: String(init.body) });
          if (url.endsWith("/tags/")) return jsonResponse({ id: 5, name: "sunset", photo_count: 0 });
          return jsonResponse({ id: 5, name: "sunset", photo_count: 1 });
        }
        if (url.includes("/tags/?photo=")) {
          return jsonResponse({ results: [{ id: 1, name: "beach", photo_count: 3, cover_photos: [] }], next: null });
        }
        if (url.includes("/tags/")) return jsonResponse({ results: [], next: null });
        if (url.includes("/photos/hashA/")) return jsonResponse(PHOTO_DETAIL);
        return jsonResponse({}, 404);
      });
      const utils = renderWithDb(<PhotoViewerScreen />, t.db, client);
      openSheet(utils);
      await waitFor(() => expect(utils.getByTestId("viewer-tag-1")).toBeTruthy());

      fireEvent.press(utils.getByTestId("viewer-tags-edit"));
      fireEvent.changeText(utils.getByTestId("viewer-tag-input"), "sunset");
      fireEvent.press(utils.getByTestId("viewer-tag-add"));

      await waitFor(() => expect(posts).toHaveLength(2));
      expect(JSON.parse(posts[0].body)).toEqual({ name: "sunset" });
      expect(posts[1].url).toContain("/tags/5/add/");
      expect(JSON.parse(posts[1].body)).toEqual({ photos: [PHOTO_ID] });
    });

    /** Tags are not mirrored: offline the section says so instead of showing none. */
    it("says tags need a connection while offline", async () => {
      globalThis.__mockNetworkConnected = false;
      const utils = renderWithDb(<PhotoViewerScreen />, t.db);
      openSheet(utils);
      await waitFor(() => expect(utils.getByTestId("viewer-tags-offline")).toBeTruthy());
      expect(utils.getByTestId("viewer-tags-edit").props.accessibilityState).toHaveProperty("disabled", true);
      expect(utils.getByTestId("viewer-location-edit").props.accessibilityState).toHaveProperty("disabled", true);
    });

    it("deletes a trashed photo for good after asking", async () => {
      t.db.run(sql`UPDATE remote_photo SET in_trashcan = 1 WHERE id = ${PHOTO_ID}`);
      const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
      const deletes: string[] = [];
      const client = makeMockClient(async (url, init) => {
        if (init?.method === "DELETE" && url.includes("/photosedit/delete/")) {
          deletes.push(String(init.body));
          return jsonResponse({ status: true, deleted: ["hashA"], not_deleted: [] });
        }
        if (url.includes("/photos/hashA/")) return jsonResponse(PHOTO_DETAIL);
        return jsonResponse({}, 404);
      });
      try {
        const utils = renderWithDb(<PhotoViewerScreen />, t.db, client);
        fireEvent.press(utils.getByTestId("viewer-more"));
        fireEvent.press(utils.getByTestId("viewer-menu-delete-permanent"));
        expect(deletes).toHaveLength(0);
        pressAlertButton(alert, "Delete permanently");

        await waitFor(() => expect(deletes).toHaveLength(1));
        expect(JSON.parse(deletes[0])).toEqual({ image_hashes: ["hashA"] });
      } finally {
        alert.mockRestore();
      }
    });
  });

  describe("media types", () => {
    it("plays the active slide as video and leaves the rest as posters", async () => {
      seedRemotePhotos(t.db, [
        remotePhoto({
          id: "22222222-2222-4222-8222-222222222222",
          imageHash: "hashV",
          type: "video",
          timestamp: Date.UTC(2024, 0, 2),
        }),
      ]);
      globalThis.__mockSearchParams = { id: "hashV" };

      const utils = renderWithDb(<PhotoViewerScreen />, t.db);
      const view = utils.getByTestId("viewer-video-hashV");
      expect(view).toBeTruthy();
      // Both slides exist, but only one player is ever mounted.
      expect(utils.getByTestId("viewer-image-hashA")).toBeTruthy();
    });

    /**
     * The big thumbnail of a GIF is one frame. Animating it means the originals
     * endpoint — but only for the slide being looked at, since originals are
     * full-size files and the pager window holds hundreds.
     */
    it("loads an animated GIF from the originals endpoint", async () => {
      const client = makeMockClient(async (url) => {
        if (url.includes("/photos/hashA/"))
          return jsonResponse({ ...PHOTO_DETAIL, image_path: ["/data/photos/anim.gif"] });
        return jsonResponse({}, 404);
      });
      const utils = renderWithDb(<PhotoViewerScreen />, t.db, client);
      await waitFor(() =>
        expect(utils.getByTestId("viewer-image-hashA").props.source).toHaveProperty(
          "uri",
          expect.stringContaining("/media/photos/hashA")
        )
      );
    });
  });

  it("offers a filmstrip over the pager window", () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "33333333-3333-4333-8333-333333333333", imageHash: "hashC", timestamp: Date.UTC(2024, 0, 2) }),
    ]);
    const utils = renderWithDb(<PhotoViewerScreen />, t.db);
    expect(utils.getByTestId("viewer-filmstrip")).toBeTruthy();
    expect(utils.getByTestId("viewer-filmstrip-33333333-3333-4333-8333-333333333333")).toBeTruthy();
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
      globalThis.__mockSearchParams = { id: "L1" };
    });

    it("opens by local asset id and renders from the camera-roll uri", () => {
      const { getByTestId } = renderWithDb(<PhotoViewerScreen />, t.db);
      const image = getByTestId("viewer-image-L1");
      expect(image).toBeTruthy();
      expect(image.props.source).toEqual({ uri: "ph://L1" });
    });

    it("hides server-only affordances and says why", async () => {
      const utils = renderWithDb(<PhotoViewerScreen />, t.db);
      // No server row → no action bar full of no-ops: Share alone.
      expect(utils.queryByTestId("viewer-action-bar")).toBeNull();
      expect(utils.getByTestId("viewer-local-action-bar")).toBeTruthy();
      expect(utils.getByTestId("viewer-share")).toBeTruthy();
      expect(utils.queryByTestId("viewer-favorite")).toBeNull();
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
