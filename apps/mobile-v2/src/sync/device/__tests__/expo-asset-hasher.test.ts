/**
 * @jest-environment node
 *
 * The regression guard for the "Preparing photos" bug: hashing must never ask
 * expo-media-library for a network download.
 *
 * On an iPhone with iCloud Photos + "Optimise iPhone Storage", asking with
 * `shouldDownloadFromNetwork: true` — the old code, and the module default —
 * made every hash pull a multi-megabyte original down the wire first, at ~1.8 s
 * per photo. Nothing in the pure pipeline can catch that, because the whole
 * difference lives in one options object passed to a native module. So this
 * suite mocks the native modules and asserts on the arguments.
 */
import type { AssetHashResult } from "../types";

// `mock`-prefixed so jest's hoisted factories may reference them.
const mockGetAssetInfoAsync = jest.fn();
const mockGetInfoAsync = jest.fn();

jest.mock("expo-media-library", () => ({ getAssetInfoAsync: mockGetAssetInfoAsync }));
jest.mock("expo-file-system/legacy", () => ({ getInfoAsync: mockGetInfoAsync }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createExpoAssetHasher } = require("../expo-asset-hasher") as typeof import("../expo-asset-hasher");

const photo = (id = "a1", uri = `ph://${id}`) => ({ id, uri, type: "image" as const });

/** The options every call must carry to stay off the network. */
const NO_NETWORK = { shouldDownloadFromNetwork: false };

beforeEach(() => {
  mockGetAssetInfoAsync.mockReset();
  mockGetInfoAsync.mockReset();
});

describe("createExpoAssetHasher().hash", () => {
  it("never allows a network download, and hashes a local asset at full speed", async () => {
    mockGetAssetInfoAsync.mockResolvedValue({ localUri: "file:///DCIM/a1.jpg" });
    mockGetInfoAsync.mockResolvedValue({ exists: true, md5: "deadbeef" });

    const result = await createExpoAssetHasher().hash(photo());

    expect(mockGetAssetInfoAsync).toHaveBeenCalledTimes(1);
    expect(mockGetAssetInfoAsync).toHaveBeenCalledWith("a1", NO_NETWORK);
    expect(mockGetInfoAsync).toHaveBeenCalledWith("file:///DCIM/a1.jpg", { md5: true });
    expect(result).toEqual<AssetHashResult>({ status: "hashed", md5: "deadbeef" });
  });

  it("classifies an iCloud-only asset as remote WITHOUT reading any bytes", async () => {
    // What iOS answers for an asset that is not on the device: no uri, and the
    // isNetworkAsset flag that only a no-network request populates.
    mockGetAssetInfoAsync.mockResolvedValue({ isNetworkAsset: true });

    const result = await createExpoAssetHasher().hash(photo());

    expect(result).toEqual<AssetHashResult>({ status: "remote" });
    // The whole point: no bytes were touched, so nothing was downloaded.
    expect(mockGetInfoAsync).not.toHaveBeenCalled();
  });

  it("calls unreadable-but-local assets unavailable, not remote", async () => {
    mockGetAssetInfoAsync.mockResolvedValue({ isNetworkAsset: false });
    expect(await createExpoAssetHasher().hash(photo())).toEqual<AssetHashResult>({
      status: "unavailable",
    });
  });

  it("prefers deferral when the platform does not report isNetworkAsset", async () => {
    // Deferral is recoverable; a permanent skip is not. An unknown answer with
    // no uri therefore parks rather than writes the asset off.
    mockGetAssetInfoAsync.mockResolvedValue({});
    expect(await createExpoAssetHasher().hash(photo())).toEqual<AssetHashResult>({ status: "remote" });
  });

  it("skips the media-library round trip entirely for a directly readable uri", async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, md5: "cafe" });

    const result = await createExpoAssetHasher().hash(photo("a1", "file:///storage/a1.jpg"));

    expect(mockGetAssetInfoAsync).not.toHaveBeenCalled();
    expect(result).toEqual<AssetHashResult>({ status: "hashed", md5: "cafe" });
  });

  it("reports a missing file as unavailable rather than a bogus hash", async () => {
    mockGetAssetInfoAsync.mockResolvedValue({ localUri: "file:///gone.jpg" });
    mockGetInfoAsync.mockResolvedValue({ exists: false });
    expect(await createExpoAssetHasher().hash(photo())).toEqual<AssetHashResult>({
      status: "unavailable",
    });
  });
});

describe("createExpoAssetHasher().materialize", () => {
  it("is the one call that may download, and returns the md5 of what it fetched", async () => {
    mockGetAssetInfoAsync.mockResolvedValue({ localUri: "file:///tmp/a1.jpg" });
    mockGetInfoAsync.mockResolvedValue({ exists: true, md5: "fetched-md5" });

    const result = await createExpoAssetHasher().materialize(photo());

    expect(mockGetAssetInfoAsync).toHaveBeenCalledWith("a1", { shouldDownloadFromNetwork: true });
    // uri + md5 together are what let the upload path spend one download.
    expect(result).toEqual({ uri: "file:///tmp/a1.jpg", md5: "fetched-md5" });
  });

  it("returns null when the original cannot be brought down", async () => {
    mockGetAssetInfoAsync.mockResolvedValue({});
    expect(await createExpoAssetHasher().materialize(photo())).toBeNull();
    expect(mockGetInfoAsync).not.toHaveBeenCalled();
  });
});
