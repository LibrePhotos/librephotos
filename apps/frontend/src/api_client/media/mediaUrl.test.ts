import { afterEach, describe, expect, it, vi } from "vitest";
import type { mediaUrl as MediaUrl } from "./mediaUrl";

type Kind = keyof typeof MediaUrl;

/** The module with `serverAddress` (and `shareAddress`) set to the given values, fresh (ApiError included). */
async function load(serverAddress: string, shareAddress = `https://photos.example${serverAddress}`) {
  vi.resetModules();
  vi.doMock("../urls", () => ({ serverAddress, shareAddress }));
  const [module, { ApiError }] = await Promise.all([import("./mediaUrl"), import("../apiError")]);
  return { ...module, ApiError };
}

afterEach(() => {
  vi.doUnmock("../urls");
  vi.unstubAllGlobals();
});

// The strings the components built by hand before mediaUrl existed, per kind.
const handBuilt: Record<Kind, (server: string, key: string) => string> = {
  squareThumbnailSmall: (s: string, h: string) => `${s}/media/square_thumbnails_small/${h}`,
  squareThumbnail: (s: string, h: string) => `${s}/media/square_thumbnails/${h}`,
  bigThumbnail: (s: string, h: string) => `${s}/media/thumbnails_big/${h}`,
  photo: (s: string, h: string) => `${s}/media/photos/${h}`,
  video: (s: string, h: string) => `${s}/media/photos/${h}.mp4`,
  embedded: (s: string, h: string) => `${s}/media/embedded_media/${h}`,
  face: (s: string, h: string) => `${s}/media/faces/${h}`,
  zip: (s: string, h: string) => `${s}/media/zip/${h}`,
};
const kinds: Kind[] = [
  "squareThumbnailSmall",
  "squareThumbnail",
  "bigThumbnail",
  "photo",
  "video",
  "embedded",
  "face",
  "zip",
];

describe("mediaUrl", () => {
  it.each(["", "/librephotos"])(
    "builds the same URLs the components built by hand (server address %o)",
    async server => {
      const { mediaUrl } = await load(server);
      expect(Object.keys(mediaUrl).sort()).toEqual([...kinds].sort());
      for (const kind of kinds) {
        for (const key of ["4b1e0c2f9a7d3e5b6c8a0f1e2d3c4b5a7", "bb6685821c52c994_2_fpZqB0S.jpg", "0b4f4c5e-6f1a"]) {
          expect(mediaUrl[kind](key), kind).toBe(handBuilt[kind](server, key));
        }
      }
    }
  );

  it("builds absolute photo links from the share address", async () => {
    const { shareMediaUrl } = await load("/librephotos", "https://photos.example/librephotos");
    expect(shareMediaUrl.photo("abc")).toBe("https://photos.example/librephotos/media/photos/abc");
  });
});

describe("fetchMedia", () => {
  it("sends the session cookies and returns a 2xx response", async () => {
    const { fetchMedia } = await load("");
    const response = new Response("zip", { status: 200 });
    const fetchMock = vi.fn<typeof fetch>(async () => response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMedia("/media/zip/abc", { signal: new AbortController().signal })).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledWith("/media/zip/abc", expect.objectContaining({ credentials: "include" }));
  });

  it.each([401, 403, 404, 500])("rejects a %i with an ApiError carrying the status", async status => {
    const { fetchMedia, ApiError } = await load("");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(null, { status }))
    );

    const error: unknown = await fetchMedia("/media/photos/abc").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, endpoint: "/media/photos/abc", serverMessage: null });
  });
});

describe("probeMedia", () => {
  it("resolves any status with the server's X-Media-Error reason, without a body", async () => {
    const { probeMedia } = await load("");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 404, headers: { "X-Media-Error": "missing" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeMedia("/media/photos/abc.mp4")).resolves.toEqual({ status: 404, mediaError: "missing" });
    expect(fetchMock).toHaveBeenCalledWith("/media/photos/abc.mp4", { method: "HEAD", credentials: "include" });
  });
});
