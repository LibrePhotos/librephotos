import { extensionForMime, saveToDevice } from "./saveToDevice";

type DownloadResult = { uri: string; status: number; headers: Record<string, string>; mimeType: string | null };
type Permission = { granted: boolean; canAskAgain: boolean };

// `mock`-prefixed so jest's hoisted factories may reference them.
const mockDownloadAsync = jest.fn<Promise<DownloadResult>, [url: string, dest: string, options: { headers: Record<string, string> }]>();
const mockMoveAsync = jest.fn<Promise<void>, [move: { from: string; to: string }]>();
const mockDeleteAsync = jest.fn<Promise<void>, [uri: string, options: { idempotent: boolean }]>();
const mockMakeDirectoryAsync = jest.fn<Promise<void>, [uri: string, options: { intermediates: boolean }]>();
const mockGetPermissionsAsync = jest.fn<Promise<Permission>, [writeOnly: boolean, granular: string[]]>();
const mockRequestPermissionsAsync = jest.fn<Promise<Permission>, [writeOnly: boolean, granular: string[]]>();
const mockSaveToLibraryAsync = jest.fn<Promise<void>, [uri: string]>();

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  downloadAsync: (url: string, dest: string, options: { headers: Record<string, string> }) =>
    mockDownloadAsync(url, dest, options),
  moveAsync: (move: { from: string; to: string }) => mockMoveAsync(move),
  deleteAsync: (uri: string, options: { idempotent: boolean }) => mockDeleteAsync(uri, options),
  makeDirectoryAsync: (uri: string, options: { intermediates: boolean }) => mockMakeDirectoryAsync(uri, options),
}));
jest.mock("expo-media-library/legacy", () => ({
  getPermissionsAsync: (writeOnly: boolean, granular: string[]) => mockGetPermissionsAsync(writeOnly, granular),
  requestPermissionsAsync: (writeOnly: boolean, granular: string[]) =>
    mockRequestPermissionsAsync(writeOnly, granular),
  saveToLibraryAsync: (uri: string) => mockSaveToLibraryAsync(uri),
}));

const GRANTED: Permission = { granted: true, canAskAgain: true };

/** A download that answers `status` with `mimeType` (as the platform reports it). */
function answer(status: number, mimeType: string | null, headers: Record<string, string> = {}) {
  mockDownloadAsync.mockImplementationOnce(async (_url, dest) => ({ uri: dest, status, headers, mimeType }));
}

const args = (imageHashes: string[]) => ({
  imageHashes,
  serverAddress: "https://photos.example/",
  accessToken: "tok",
});

beforeEach(() => {
  for (const mock of [
    mockDownloadAsync,
    mockMoveAsync,
    mockDeleteAsync,
    mockMakeDirectoryAsync,
    mockGetPermissionsAsync,
    mockRequestPermissionsAsync,
    mockSaveToLibraryAsync,
  ]) {
    mock.mockReset();
  }
  mockMoveAsync.mockResolvedValue();
  mockDeleteAsync.mockResolvedValue();
  mockMakeDirectoryAsync.mockResolvedValue();
  mockSaveToLibraryAsync.mockResolvedValue();
  mockGetPermissionsAsync.mockResolvedValue(GRANTED);
});

describe("extensionForMime", () => {
  it("maps the types a gallery takes, ignoring parameters and case", () => {
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("IMAGE/HEIC")).toBe("heic");
    expect(extensionForMime("video/quicktime; charset=binary")).toBe("mov");
    expect(extensionForMime("video/mp4")).toBe("mp4");
  });

  it("has no extension for camera RAW, unknown or missing types", () => {
    expect(extensionForMime("image/x-dcraw")).toBeNull();
    expect(extensionForMime("application/octet-stream")).toBeNull();
    expect(extensionForMime(null)).toBeNull();
  });
});

describe("saveToDevice", () => {
  it("downloads each original with the bearer token and saves it under its real extension", async () => {
    answer(200, "image/heic");
    answer(200, null, { "content-type": "video/mp4" });

    const result = await saveToDevice(args(["h1", "h2"]));

    expect(result).toEqual({ kind: "done", saved: 2, failed: 0 });
    const [url, dest, options] = mockDownloadAsync.mock.calls[0] ?? [];
    expect(url).toBe("https://photos.example/media/photos/h1");
    expect(options).toEqual({ headers: { Authorization: "Bearer tok" } });
    expect(dest).toMatch(/^file:\/\/\/cache\/save-to-device\/.+\/h1$/);
    expect(mockSaveToLibraryAsync.mock.calls.map(([uri]) => uri.split(".").pop())).toEqual(["heic", "mp4"]);
    expect(mockMoveAsync).toHaveBeenCalledWith({ from: dest, to: `${dest}.heic` });
    // The run's cache directory goes once it is done.
    const dir = mockMakeDirectoryAsync.mock.calls[0]?.[0];
    expect(mockDeleteAsync).toHaveBeenCalledWith(dir, { idempotent: true });
  });

  it("counts a refused download or a type the gallery would not take as failed, and goes on", async () => {
    answer(404, "text/html");
    answer(200, "image/x-dcraw");
    answer(200, "image/jpeg");

    const result = await saveToDevice(args(["missing", "raw", "ok"]));

    expect(result).toEqual({ kind: "done", saved: 1, failed: 2 });
    expect(mockSaveToLibraryAsync).toHaveBeenCalledTimes(1);
    expect(mockSaveToLibraryAsync.mock.calls[0]?.[0]).toMatch(/\/ok\.jpg$/);
  });

  it("counts a gallery that throws as failed", async () => {
    answer(200, "image/png");
    mockSaveToLibraryAsync.mockRejectedValueOnce(new Error("unsupported"));

    expect(await saveToDevice(args(["h1"]))).toEqual({ kind: "done", saved: 0, failed: 1 });
  });

  it("asks for add-only gallery access, and fetches nothing when it is refused", async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });

    expect(await saveToDevice(args(["h1"]))).toEqual({ kind: "permissionDenied" });
    expect(mockRequestPermissionsAsync).toHaveBeenCalledWith(true, ["photo", "video"]);
    expect(mockDownloadAsync).not.toHaveBeenCalled();
  });

  it("does not ask again once the user said never", async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });

    expect(await saveToDevice(args(["h1"]))).toEqual({ kind: "permissionDenied" });
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });
});
