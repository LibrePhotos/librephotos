import { fireEvent, waitFor } from "@testing-library/react-native";
import { createTestDb, type TestDb } from "@/db/test-db";
import { useSettingsStore } from "@/stores/settings";
import { jsonResponse, makeMockClient, mockRouter, renderWithDb } from "@/test/test-utils";
import { FolderScreen, folderName } from "./FolderScreen";

jest.mock("@/sync/run", () => ({ runSync: () => Promise.resolve(null) }));
// The share sheet asks the server who the user is as it mounts; not under test here.
jest.mock("@/features/sharing/ShareSheet", () => ({ ShareSheet: () => null }));

const ROOT = "/data/photos";
const TRIPS = "/data/photos/trips";

function listing(current: string, parent: string | null, results: { name: string; path: string; photo_count: number }[]) {
  return {
    current_path: current,
    parent_path: parent,
    results: results.map((r) => ({ ...r, modified: 0, cover_photo: null })),
    count: results.length,
    next: null,
    previous: null,
    page: 1,
    page_size: 100,
    num_pages: 1,
  };
}

const PHOTO = "00000000-0000-4000-8000-0000000000f1";

/** A server with a scan directory holding `trips`, which holds `rome` and one photo. */
function server(seen: string[] = []) {
  return makeMockClient(async (url) => {
    seen.push(url);
    if (url.includes("/folders/subfolders/") && url.includes("path=")) {
      return jsonResponse(listing(TRIPS, ROOT, [{ name: "rome", path: `${TRIPS}/rome`, photo_count: 4 }]));
    }
    if (url.includes("/folders/subfolders/")) {
      return jsonResponse(listing(ROOT, null, [{ name: "trips", path: TRIPS, photo_count: 5 }]));
    }
    if (url.includes("/api/days/?")) {
      return jsonResponse({ results: [{ id: 20240501, date: "2024-05-01", location: "", numberOfItems: 1 }] });
    }
    if (url.includes("/api/days/20240501/photos/")) {
      return jsonResponse({ items: [{ id: PHOTO, image_hash: "hash-f", aspectRatio: 1 }], next: null });
    }
    return jsonResponse({}, 404);
  });
}

describe("folderName", () => {
  it("takes the last segment of a POSIX or Windows path", () => {
    expect(folderName("/data/photos/trips")).toBe("trips");
    expect(folderName("C:\\Users\\me\\photos\\raw")).toBe("raw");
    expect(folderName("/data/photos/")).toBe("photos");
  });
});

describe("FolderScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    globalThis.__mockNetworkConnected = true;
    useSettingsStore.setState({ serverUrl: "https://test.local" });
    jest.clearAllMocks();
  });
  afterEach(() => {
    t.close();
    globalThis.__mockNetworkConnected = true;
  });

  it("lists the scan directory's folders at the top, without asking for photos", async () => {
    const seen: string[] = [];
    const { getByTestId } = renderWithDb(<FolderScreen id="root" />, t.db, server(seen));
    await waitFor(() => expect(getByTestId("folder-row-trips")).toBeTruthy());
    expect(getByTestId("folder-title").props.children).toBe("Folders");
    expect(getByTestId("folder-path").props.children).toBe(ROOT);
    expect(seen.some((url) => url.includes("/days/"))).toBe(false);

    fireEvent.press(getByTestId("folder-row-trips"));
    expect(mockRouter().push).toHaveBeenCalledWith({ pathname: "/albums/folders/[id]", params: { id: TRIPS } });
  });

  it("shows a folder's subfolders and its photos", async () => {
    const seen: string[] = [];
    const { getByTestId } = renderWithDb(<FolderScreen id={TRIPS} />, t.db, server(seen));
    await waitFor(() => expect(getByTestId(`tile-${PHOTO}`)).toBeTruthy());
    expect(getByTestId("folder-row-rome")).toBeTruthy();
    expect(getByTestId("folder-title").props.children).toBe("trips");
    expect(seen).toContain(`https://test.local/api/folders/subfolders/?path=${encodeURIComponent(TRIPS)}`);
    expect(seen).toContain(`https://test.local/api/days/?folder=${encodeURIComponent(TRIPS)}`);
    expect(seen).toContain(`https://test.local/api/days/20240501/photos/?folder=${encodeURIComponent(TRIPS)}&limit=100`);

    // A long press starts multi-select.
    fireEvent(getByTestId(`tile-${PHOTO}`), "longPress");
    expect(getByTestId("selection-action-bar")).toBeTruthy();
  });

  it("shows the offline state when nothing was loaded", async () => {
    globalThis.__mockNetworkConnected = false;
    const { getByTestId } = renderWithDb(
      <FolderScreen id={TRIPS} />,
      t.db,
      makeMockClient(async () => jsonResponse({}, 500))
    );
    await waitFor(() => expect(getByTestId("folder-offline")).toBeTruthy());
  });

  it("says an empty folder is empty", async () => {
    const client = makeMockClient(async (url) => {
      if (url.includes("/folders/subfolders/")) return jsonResponse(listing(TRIPS, ROOT, []));
      if (url.includes("/api/days/?")) return jsonResponse({ results: [] });
      return jsonResponse({}, 404);
    });
    const { getByTestId } = renderWithDb(<FolderScreen id={TRIPS} />, t.db, client);
    await waitFor(() => expect(getByTestId("folder-empty")).toBeTruthy());
  });
});
