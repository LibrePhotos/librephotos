import { act, fireEvent, waitFor } from "@testing-library/react-native";
import type { ImageLoadEventData, ImageProgressEventData } from "expo-image";
import { PhotoViewerScreen } from "./PhotoViewerScreen";
import { useSettingsStore } from "@/stores/settings";
import { jsonResponse, makeMockClient, renderWithDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";

/**
 * Pinching or double-tapping a photo loads its original (#2743). The gestures
 * are native, so the zoomable image is stubbed: the test plays its zoom and
 * load events and reads back the source it was given.
 */
type StubProps = {
  testID?: string;
  source: { uri: string };
  placeholder?: { uri: string };
  onZoomChange?: (zoomed: boolean) => void;
  onProgress?: (event: ImageProgressEventData) => void;
  onLoad?: (event: ImageLoadEventData) => void;
  onError?: () => void;
};
const mockImages = new Map<string, StubProps>();
jest.mock("./ZoomableImage", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ZoomableImage: (props: StubProps) => {
      if (props.testID) mockImages.set(props.testID, props);
      return <View testID={props.testID} />;
    },
  };
});
jest.mock("@/sync/triggers", () => ({ notifyOutboxWrite: jest.fn<void, unknown[]>() }));
jest.mock("./useImagePixelSize", () => ({
  useImagePixelSize: jest.fn(() => ({ width: 1440, height: 1080 })),
}));

const PHOTO_ID = "11111111-1111-4111-8111-111111111111";
const DETAIL = {
  id: PHOTO_ID,
  camera: null,
  exif_gps_lat: null,
  exif_gps_lon: null,
  exif_timestamp: "2024-01-03T10:00:00",
  search_captions: null,
  search_location: null,
  captions_json: null,
  big_thumbnail_url: "",
  small_square_thumbnail_url: "",
  geolocation_json: null,
  people: [],
  image_hash: "hashA",
  image_path: ["/data/photos/2024/IMG_0001.JPG"],
  rating: 0,
  hidden: false,
  public: false,
  in_trashcan: false,
  removed: false,
  size: 4_194_304,
  shared_to: [],
  similar_photos: [],
  video: false,
  owner: { id: 1, username: "u", first_name: "", last_name: "" },
  shutter_speed: null,
  height: 3024,
  width: 4032,
  fstop: null,
  iso: null,
  focal_length: null,
  focalLength35Equivalent: null,
  subjectDistance: null,
  digitalZoomRatio: null,
  lens: null,
  embedded_media: [],
  local_orientation: 1,
  original_mime_type: "image/jpeg",
};

function image() {
  const props = mockImages.get("viewer-image-hashA");
  if (!props) throw new Error("the photo was not rendered");
  return props;
}

function loadEvent(width: number, height: number): ImageLoadEventData {
  return { cacheType: "none", source: { url: "", width, height, mediaType: "image/jpeg" } };
}

describe("PhotoViewerScreen zooming into the original", () => {
  let t: TestDb;
  beforeEach(() => {
    mockImages.clear();
    useSettingsStore.setState({ serverUrl: "https://test.local" });
    globalThis.__mockSearchParams = { id: "hashA" };
    t = createTestDb();
    seedRemotePhotos(t.db, [remotePhoto({ id: PHOTO_ID, imageHash: "hashA", timestamp: Date.UTC(2024, 0, 3) })]);
  });
  afterEach(() => {
    t.close();
    globalThis.__mockSearchParams = undefined;
  });

  async function open(detail: Record<string, unknown> = DETAIL) {
    const client = makeMockClient(async (url) =>
      url.includes("/photos/hashA/") ? jsonResponse(detail) : jsonResponse({}, 404)
    );
    const utils = renderWithDb(<PhotoViewerScreen />, t.db, client);
    // The details arrive after the first paint; the zoom decision reads them.
    await waitFor(() => expect(utils.queryByText("Loading details…")).toBeNull());
    await waitFor(() => expect(image().onZoomChange).toBeDefined());
    return utils;
  }

  it("shows the big thumbnail until the user zooms in, then loads the original over it", async () => {
    const utils = await open();
    await waitFor(() => expect(image().source.uri).toContain("/media/thumbnails_big/hashA"));
    expect(utils.queryByTestId("viewer-resolution-chip")).toBeNull();

    act(() => image().onZoomChange?.(true));
    await waitFor(() => expect(image().source.uri).toContain("/media/photos/hashA"));
    // The big thumbnail stays on screen while the original loads.
    expect(image().placeholder?.uri).toContain("/media/thumbnails_big/hashA");
    expect(utils.getByText("Loading original")).toBeTruthy();

    act(() => image().onProgress?.({ loaded: 1024 * 1024, total: 4 * 1024 * 1024 }));
    expect(utils.getByText("Loading original · 1 MB of 4 MB")).toBeTruthy();

    act(() => image().onLoad?.(loadEvent(4032, 3024)));
    expect(utils.getByText("Original · 4032 × 3024")).toBeTruthy();

    // Zooming out hides the chip but keeps the original.
    act(() => image().onZoomChange?.(false));
    expect(utils.queryByTestId("viewer-resolution-chip")).toBeNull();
    expect(image().source.uri).toContain("/media/photos/hashA");
  });

  it("offers Try again when the original fails, and asks the server again", async () => {
    const utils = await open();
    act(() => image().onZoomChange?.(true));
    await waitFor(() => expect(image().onError).toBeDefined());
    act(() => image().onError?.());
    expect(utils.getByText("The original did not load")).toBeTruthy();

    fireEvent.press(utils.getByTestId("viewer-original-retry"));
    expect(image().source.uri).toContain("/media/photos/hashA?retry=1");
    expect(utils.getByText("Loading original")).toBeTruthy();
  });

  it("keeps the preview of a RAW original and says why", async () => {
    const utils = await open({ ...DETAIL, original_mime_type: "image/x-dcraw" });
    act(() => image().onZoomChange?.(true));

    await waitFor(() => expect(utils.getByText("Preview · RAW files can't be shown here")).toBeTruthy());
    expect(image().source.uri).toContain("/media/thumbnails_big/hashA");
    expect(image().onLoad).toBeUndefined();
  });
});
