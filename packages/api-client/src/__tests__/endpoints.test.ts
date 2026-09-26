import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../transport";
import type { TokenSupplier } from "../transport";
import * as endpoints from "../endpoints";

const FUTURE_JWT =
  "eyJhbGciOiJIUzI1NiJ9." +
  Buffer.from(JSON.stringify({ exp: 9999999999, user_id: 1 })).toString("base64url") +
  ".sig";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function tokens(): TokenSupplier {
  return {
    getAccessToken: () => FUTURE_JWT,
    getRefreshToken: () => "r",
    setAccessToken: () => {},
    clearTokens: () => {},
  };
}

/** Capture the (url, init) of the last data request and return a canned body. */
function harness(body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(jsonResponse(body));
  });
  const client = createApiClient({ baseUrl: "https://demo.example.com", tokens: tokens(), fetch: fetchMock });
  return { client, calls };
}

describe("album detail endpoints", () => {
  it("fetches thing album detail and unwraps results", async () => {
    const { client, calls } = harness({ results: { id: "5", title: "Dog", grouped_photos: [] } });
    const album = await endpoints.fetchThingAlbum(client, 5);
    expect(calls[0]!.url).toBe("https://demo.example.com/api/albums/thing/5/");
    expect(album.title).toBe("Dog");
  });

  it("fetches place album detail", async () => {
    const { client, calls } = harness({ results: { id: "3", title: "Berlin", grouped_photos: [] } });
    await endpoints.fetchPlaceAlbum(client, 3);
    expect(calls[0]!.url).toBe("https://demo.example.com/api/albums/place/3/");
  });

  it("fetches tag album detail via /tags/", async () => {
    const { client, calls } = harness({ results: { id: 7, name: "sunset", grouped_photos: [] } });
    await endpoints.fetchTagAlbum(client, 7);
    expect(calls[0]!.url).toBe("https://demo.example.com/api/tags/7/");
  });
});

describe("sharing endpoints", () => {
  it("sends share photos payload", async () => {
    const { client, calls } = harness({ status: true, count: 1 });
    await endpoints.setPhotosShared(client, ["h1", "h2"], 42, true);
    expect(calls[0]!.url).toBe("https://demo.example.com/api/photosedit/share/");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({
      image_hashes: ["h1", "h2"],
      target_user_id: 42,
      val_shared: true,
    });
  });

  it("sends album share payload with string ids", async () => {
    const { client, calls } = harness({ status: true });
    await endpoints.setUserAlbumShared(client, 9, 3, false);
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({
      album_id: "9",
      target_user_id: "3",
      shared: false,
    });
  });

  it("unwraps shared-with-me photos", async () => {
    const { client } = harness({
      results: [{ id: "00000000-0000-4000-8000-000000000001", image_hash: "h", aspectRatio: 1 }],
    });
    const photos = await endpoints.fetchSharedPhotosWithMe(client);
    expect(photos).toHaveLength(1);
  });
});

describe("public link endpoints", () => {
  it("sends makepublic payload", async () => {
    const { client, calls } = harness({ status: true });
    await endpoints.setPhotosPublic(client, ["h1"], true);
    expect(calls[0]!.url).toBe("https://demo.example.com/api/photosedit/makepublic/");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ image_hashes: ["h1"], val_public: true });
  });
});

describe("faces endpoints", () => {
  it("builds the faces list query with defaults", async () => {
    const { client, calls } = harness({ count: 0, next: null, previous: null, results: [] });
    await endpoints.fetchFaces(client, { person: 4, inferred: true });
    expect(calls[0]!.url).toContain("/api/faces/?");
    expect(calls[0]!.url).toContain("person=4");
    expect(calls[0]!.url).toContain("inferred=true");
    expect(calls[0]!.url).toContain("order_by=confidence");
  });

  it("labels faces with a person name", async () => {
    const { client, calls } = harness({ status: true, results: [], updated: [], not_updated: [] });
    await endpoints.labelFaces(client, [1, 2], "Alice");
    expect(calls[0]!.url).toBe("https://demo.example.com/api/labelfaces");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ face_ids: [1, 2], person_name: "Alice" });
  });

  it("deletes faces", async () => {
    const { client, calls } = harness({ status: true, results: [], deleted: [], not_deleted: [] });
    await endpoints.deleteFaces(client, [5]);
    expect(calls[0]!.url).toBe("https://demo.example.com/api/deletefaces");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ face_ids: [5] });
  });

  it("fetches the incomplete-faces bare array", async () => {
    const { client, calls } = harness([{ id: 1, name: "Bob", face_count: 3 }]);
    const rows = await endpoints.fetchIncompleteFaces(client, { inferred: false });
    expect(calls[0]!.url).toContain("/api/faces/incomplete/?");
    expect(rows).toHaveLength(1);
  });
});

describe("admin/jobs endpoints", () => {
  it("triggers a library scan", async () => {
    const { client, calls } = harness({ status: true, job_id: "job-1" });
    const res = await endpoints.scanPhotos(client);
    expect(calls[0]!.url).toBe("https://demo.example.com/api/scanphotos/");
    expect(res.job_id).toBe("job-1");
  });

  it("reads worker availability", async () => {
    const { client, calls } = harness({ status: true, queue_can_accept_job: true });
    const res = await endpoints.fetchWorkerAvailability(client);
    expect(calls[0]!.url).toBe("https://demo.example.com/api/rqavailable/");
    expect(res.queue_can_accept_job).toBe(true);
  });
});
