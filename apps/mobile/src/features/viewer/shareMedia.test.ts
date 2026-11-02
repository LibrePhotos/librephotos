import * as Sharing from "expo-sharing";
import { shareMedia, splitFilename } from "./shareMedia";
import { pickerInitialDate, toNaiveTimestamp } from "./timestamp";

type DownloadResult = { uri: string; status: number; headers: Record<string, string>; mimeType: string | null };

// `mock`-prefixed so jest's hoisted factories may reference them.
const mockDownloadAsync = jest.fn<Promise<DownloadResult>, [url: string, dest: string]>();
const mockMoveAsync = jest.fn<Promise<void>, [move: { from: string; to: string }]>(async () => {});
const mockGetAssetInfoAsync = jest.fn<Promise<{ localUri?: string }>, [id: string]>();

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  downloadAsync: (url: string, dest: string) => mockDownloadAsync(url, dest),
  moveAsync: (move: { from: string; to: string }) => mockMoveAsync(move),
  deleteAsync: jest.fn(async () => {}),
  makeDirectoryAsync: jest.fn(async () => {}),
}));
jest.mock("expo-media-library/legacy", () => ({
  getAssetInfoAsync: (id: string) => mockGetAssetInfoAsync(id),
}));

const SERVER = "https://photos.example";

function answer(status: number, mimeType: string | null) {
  mockDownloadAsync.mockImplementationOnce(async (_url, dest) => ({ uri: dest, status, headers: {}, mimeType }));
}

describe("shareMedia", () => {
  beforeEach(() => {
    jest.mocked(Sharing.shareAsync).mockClear();
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
    mockDownloadAsync.mockReset();
    mockMoveAsync.mockClear();
    mockGetAssetInfoAsync.mockReset();
  });

  it("downloads a server original under its own name and shares it", async () => {
    answer(200, "image/jpeg; charset=binary");
    const result = await shareMedia({
      target: { kind: "remote", imageHash: "h1", filename: "IMG_0001.JPG" },
      serverAddress: SERVER,
      accessToken: "tok",
    });
    expect(result).toBe("shared");
    expect(mockDownloadAsync.mock.lastCall?.[0]).toBe(`${SERVER}/media/photos/h1`);
    expect(mockMoveAsync).toHaveBeenCalledWith({ from: "file:///cache/share/h1", to: "file:///cache/share/IMG_0001.jpg" });
    expect(Sharing.shareAsync).toHaveBeenCalledWith("file:///cache/share/IMG_0001.jpg", {
      mimeType: "image/jpeg",
      dialogTitle: undefined,
    });
  });

  /** A RAW is served as `image/x-dcraw`: its file name is the only hint of its format. */
  it("keeps the file's own extension when the served type says nothing", async () => {
    answer(200, "image/x-dcraw");
    await shareMedia({
      target: { kind: "remote", imageHash: "h2", filename: "DSC_9.NEF" },
      serverAddress: SERVER,
      accessToken: null,
    });
    expect(jest.mocked(Sharing.shareAsync).mock.lastCall?.[0]).toBe("file:///cache/share/DSC_9.NEF");
  });

  it("fails without sharing when the server refuses", async () => {
    answer(404, null);
    const result = await shareMedia({
      target: { kind: "remote", imageHash: "h3", filename: null },
      serverAddress: SERVER,
      accessToken: "tok",
    });
    expect(result).toBe("failed");
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it("shares a phone file as is, resolving an iOS ph:// asset first", async () => {
    mockGetAssetInfoAsync.mockResolvedValueOnce({ localUri: "file:///var/IMG_7.HEIC" });
    const result = await shareMedia({
      target: { kind: "local", localId: "A7", uri: "ph://A7" },
      serverAddress: SERVER,
      accessToken: null,
    });
    expect(result).toBe("shared");
    expect(mockDownloadAsync).not.toHaveBeenCalled();
    expect(jest.mocked(Sharing.shareAsync).mock.lastCall?.[0]).toBe("file:///var/IMG_7.HEIC");
  });

  it("says so when the device cannot share", async () => {
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
    const result = await shareMedia({
      target: { kind: "local", localId: null, uri: "file:///a.jpg" },
      serverAddress: SERVER,
      accessToken: null,
    });
    expect(result).toBe("unavailable");
  });
});

describe("splitFilename", () => {
  it("splits and sanitises", () => {
    expect(splitFilename("IMG_0001.JPG")).toEqual({ stem: "IMG_0001", extension: "JPG" });
    expect(splitFilename("a/b:c.png")).toEqual({ stem: "a_b_c", extension: "png" });
    expect(splitFilename("README")).toEqual({ stem: "README", extension: null });
    expect(splitFilename(null)).toEqual({ stem: null, extension: null });
  });
});

describe("picker timestamps", () => {
  it("writes a picked local date as the naive timestamp the backend stores", () => {
    expect(toNaiveTimestamp(new Date(2020, 4, 6, 7, 8, 9))).toBe("2020-05-06T07:08:09");
  });

  it("starts from the photo's date, or now without one", () => {
    const now = new Date(2026, 0, 1);
    expect(pickerInitialDate(null, now)).toBe(now);
    expect(pickerInitialDate("not a date", now)).toBe(now);
    expect(pickerInitialDate("2024-01-03T10:00:00", now).getFullYear()).toBe(2024);
  });
});
