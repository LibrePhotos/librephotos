/**
 * The tag endpoints (issue #2347): the request each one sends and the parsed answer, against what
 * TagViewSet (api/views/tags.py) answered in a test run.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { Tag, TagAlbumResponse, TagListResponse } from "../schemas";
import { defined } from "./defined";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";

const tagRow = {
  id: 7,
  name: "beach",
  photo_count: 2,
  cover_photos: [
    { image_hash: "a".repeat(32), video: false },
    { image_hash: "b".repeat(32), video: true },
  ],
};
const page = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results, page: 1 });

describe("tag schemas", () => {
  it("a tag without photos still parses", () => {
    const parsed = TagListResponse.parse(page([{ id: 8, name: "empty", photo_count: 0, cover_photos: [] }]));
    expect(defined(parsed.results[0]).cover_photos).toEqual([]);
  });

  it("a tag id that arrives as a string is rejected rather than silently coerced", () => {
    // The lightbox editor feeds the id straight back into /tags/<id>/add/, so a string id has to
    // surface as a parse error instead of a bad request.
    expect(Tag.safeParse({ id: "9", name: "sunset", photo_count: 0 }).success).toBe(false);
  });

  it("the tag detail keeps the grouped photo shape", () => {
    const parsed = TagAlbumResponse.parse({
      results: {
        id: 7,
        name: "beach",
        grouped_photos: [
          {
            date: "2023-05-01",
            location: "Lisbon",
            items: [{ id: "123e4567-e89b-12d3-a456-426614174000", image_hash: "c".repeat(32), aspectRatio: 1.5 }],
          },
        ],
      },
    });
    expect(defined(parsed.results.grouped_photos[0]).items).toHaveLength(1);
  });
});

describe("tag reads", () => {
  it("reads every page of a photo's tags", async () => {
    const { client, requests } = fakeServer(page([tagRow]));
    const tags = await endpoints.fetchPhotoTags(client, "h1");
    expect(defined(requests[0]).url).toBe(`${API}/tags/?photo=h1`);
    expect(defined(tags[0]).cover_photos).toHaveLength(2);
  });

  it("passes the media-type filter to a tag album", async () => {
    const album = { results: { id: 7, name: "beach", grouped_photos: [] } };
    const { client, requests } = fakeServer(album);
    await endpoints.fetchTagAlbum(client, 7, { video: true });
    await endpoints.fetchTagAlbum(client, "7");
    expect(requests.map(request => request.url)).toEqual([`${API}/tags/7/?video=true`, `${API}/tags/7/`]);
  });
});

describe("tag changes", () => {
  it("creates, renames and merges tags and answers the tag", async () => {
    const create = fakeServer({ id: 1, name: "beach", photo_count: 0 });
    expect(await endpoints.createTag(create.client, "beach")).toEqual({ id: 1, name: "beach", photo_count: 0 });
    const rename = fakeServer({ id: 1, name: "shore", photo_count: 1 });
    expect((await endpoints.renameTag(rename.client, 1, "shore")).name).toBe("shore");
    const merge = fakeServer({ id: 1, name: "shore", photo_count: 4 });
    expect((await endpoints.mergeTags(merge.client, 1, 2)).photo_count).toBe(4);
    const sent = [create, rename, merge].map(({ requests }) => defined(requests[0]));
    expect(sent.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
      { url: `${API}/tags/`, method: "POST", body: { name: "beach" } },
      { url: `${API}/tags/1/`, method: "PATCH", body: { name: "shore" } },
      { url: `${API}/tags/1/merge/`, method: "POST", body: { tag: 2 } },
    ]);
  });

  it("deletes a tag (204)", async () => {
    const { client, requests } = fakeServer(null);
    await endpoints.deleteTag(client, 1);
    expect(defined(requests[0])).toMatchObject({ url: `${API}/tags/1/`, method: "DELETE" });
  });

  it("adds and removes photos by id or hash, and adds a selected-all set", async () => {
    const { client, requests } = fakeServer({ id: 1, name: "beach", photo_count: 2 });
    await endpoints.addPhotosToTag(client, 1, ["p1", "h2"]);
    await endpoints.addPhotosToTag(client, 1, [], { query: { person: 3 }, excludedHashes: ["x"] });
    await endpoints.addPhotosToTag(client, 1, [], {});
    await endpoints.removePhotosFromTag(client, 1, ["h2"]);
    expect(requests.map(({ url, body }) => ({ url, body }))).toEqual([
      { url: `${API}/tags/1/add/`, body: { photos: ["p1", "h2"] } },
      { url: `${API}/tags/1/add/`, body: { select_all: true, query: { person: 3 }, excluded_hashes: ["x"] } },
      { url: `${API}/tags/1/add/`, body: { select_all: true, query: {}, excluded_hashes: [] } },
      { url: `${API}/tags/1/remove/`, body: { photos: ["h2"] } },
    ]);
  });
});
