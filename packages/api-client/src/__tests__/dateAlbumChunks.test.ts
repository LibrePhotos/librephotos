/**
 * A filtered date-album list read a chunk of photos at a time (the phone's person and folder grids):
 * the list answers day groups without their photos, each day is read by pages of 100.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { albumKeys, dateAlbumPhotoChunksQueryOptions, photoGridKeys } from "../hooks";
import { IncompleteDatePhotosGroup, Photoset } from "../schemas";
import { defined } from "./defined";
import { fakeServerByUrl } from "./harness";

const API = "https://demo.example.com/api";

const photo = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  image_hash: `hash${n}`,
  aspectRatio: 1,
});

const day = (id: number, numberOfItems: number, items: ReturnType<typeof photo>[] = []): IncompleteDatePhotosGroup =>
  IncompleteDatePhotosGroup.parse({
    id,
    date: `2024-01-${String(id).padStart(2, "0")}`,
    location: null,
    incomplete: items.length === 0,
    numberOfItems,
    items,
  });

/** The server's answer to `/albums/date/{id}/?page=`: the day with `count` photos numbered from `first`. */
function dayPage(id: number, first: number, count: number) {
  return {
    results: {
      id,
      date: null,
      location: null,
      incomplete: false,
      numberOfItems: count,
      items: Array.from({ length: count }, (_, i) => photo(first + i)),
    },
  };
}

describe("fetchDateAlbumPhotosChunk", () => {
  it("reads small days together until about a page of photos, keeping the list order", async () => {
    const { client, requests } = fakeServerByUrl(url => {
      const id = Number(/\/albums\/date\/(\d+)\//.exec(url)?.[1]);
      return dayPage(id, id * 10, 1);
    });
    const groups = [day(1, 1), day(2, 1), day(3, 1)];
    const chunk = await endpoints.fetchDateAlbumPhotosChunk(client, groups, { group: 0, page: 1 }, { person: 7 });
    expect(chunk.photos.map(p => p.image_hash)).toEqual(["hash10", "hash20", "hash30"]);
    expect(chunk.next).toBeNull();
    expect(defined(requests[0]).url).toBe(`${API}/albums/date/1/?person=7&page=1`);
  });

  it("stops at the photo budget and continues inside a big day on its next page", async () => {
    const { client, requests } = fakeServerByUrl(url => {
      const page = Number(/page=(\d+)/.exec(url)?.[1]);
      return dayPage(1, (page - 1) * 100, 100);
    });
    const groups = [day(1, 250), day(2, 3)];
    const first = await endpoints.fetchDateAlbumPhotosChunk(client, groups, { group: 0, page: 1 });
    expect(first.photos).toHaveLength(100);
    expect(first.next).toEqual({ group: 0, page: 2 });
    const second = await endpoints.fetchDateAlbumPhotosChunk(client, groups, defined(first.next));
    expect(defined(second.photos[0]).image_hash).toBe("hash100");
    expect(second.next).toEqual({ group: 0, page: 3 });
    expect(requests.map(r => r.url)).toEqual([`${API}/albums/date/1/?page=1`, `${API}/albums/date/1/?page=2`]);
  });

  it("does not fetch a day the list sent whole, and caps the requests of one chunk", async () => {
    const { client, requests } = fakeServerByUrl(url => {
      const id = Number(/\/albums\/date\/(\d+)\//.exec(url)?.[1]);
      return dayPage(id, id * 10, 1);
    });
    const groups = [day(1, 1, [photo(1)]), day(2, 1), day(3, 1), day(4, 1)];
    const chunk = await endpoints.fetchDateAlbumPhotosChunk(client, groups, { group: 0, page: 1 }, {}, { requests: 2 });
    expect(chunk.photos.map(p => p.image_hash)).toEqual(["hash1", "hash20"]);
    expect(chunk.next).toEqual({ group: 2, page: 1 });
    expect(requests).toHaveLength(1);
  });

  it("answers nothing for an empty list", async () => {
    const { client, requests } = fakeServerByUrl(() => ({}));
    const chunk = await endpoints.fetchDateAlbumPhotosChunk(client, [], { group: 0, page: 1 });
    expect(chunk).toEqual({ photos: [], next: null });
    expect(requests).toHaveLength(0);
  });
});

describe("date-album photo chunks query", () => {
  it("reads the list with the first chunk and carries it to the next", async () => {
    const { client, requests } = fakeServerByUrl(url => {
      if (url.includes("/albums/date/list/")) return { results: [day(4, 150), day(5, 2)] };
      const page = Number(/page=(\d+)/.exec(url)?.[1]);
      return dayPage(4, (page - 1) * 100, page === 1 ? 100 : 50);
    });
    const options = dateAlbumPhotoChunksQueryOptions(client, Photoset.PERSON, { person: 3 });
    const queryClient = new QueryClient();
    const data = await queryClient.infiniteQuery(options);
    const first = defined(data.pages[0]);
    expect(first.groups.map(g => g.id)).toEqual([4, 5]);
    expect(first.photos).toHaveLength(100);
    expect(defined(requests[0]).url).toBe(`${API}/albums/date/list/?person=3`);
    expect(options.getNextPageParam(first, data.pages, null, data.pageParams)).toEqual({
      groups: first.groups,
      cursor: { group: 0, page: 2 },
    });
  });

  it("keys a person's chunks under the person lists, apart per filter", () => {
    const { client } = fakeServerByUrl(() => ({}));
    const one = dateAlbumPhotoChunksQueryOptions(client, Photoset.PERSON, { person: 1 }).queryKey;
    const two = dateAlbumPhotoChunksQueryOptions(client, Photoset.PERSON, { person: 2 }).queryKey;
    expect(one).not.toEqual(two);
    expect(one.slice(0, 3)).toEqual(photoGridKeys.dateAlbumLists(Photoset.PERSON));
  });

  it("keeps the raw person under the person the web shows", () => {
    expect(albumKeys.personRaw(5).slice(0, 4)).toEqual(albumKeys.person(5));
  });
});
