/**
 * A filtered day list read a chunk of photos at a time (the phone's person and folder grids): the
 * list answers days without their photos, each day is read by pages of 100 through `after` cursors.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as endpoints from "../endpoints";
import { albumKeys, dateAlbumPhotoChunksQueryOptions, photoGridKeys } from "../hooks";
import { IncompleteDatePhotosGroup, Photoset } from "../schemas";
import { defined } from "./defined";
import { fakeServerByUrl, heldServerByUrl } from "./harness";

const API = "https://demo.example.com/api";

/** The `n`th photo of day `dayId` (from 0), with an id that tells both apart. */
const photo = (dayId: number, n: number) => ({
  id: `00000000-0000-4000-8000-${String(dayId * 1000 + n).padStart(12, "0")}`,
  image_hash: `hash${dayId}-${n}`,
  aspectRatio: 1,
});

const day = (id: number, numberOfItems: number, items: ReturnType<typeof photo>[] = []): IncompleteDatePhotosGroup =>
  IncompleteDatePhotosGroup.parse({
    id,
    date: `2024-01-${String(id).padStart(2, "0")}`,
    location: "",
    incomplete: items.length === 0,
    numberOfItems,
    items,
  });

/**
 * The server of `/days/` and `/days/{id}/photos/?after=&limit=` for days of `sizes[id]` photos:
 * the `limit` photos after `after` and the last one's id as `next` while more are left.
 */
function dayServer(sizes: Record<number, number>) {
  return (url: string) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/days/") {
      return {
        results: Object.entries(sizes).map(([id, size]) => ({
          id: Number(id),
          date: null,
          location: "",
          numberOfItems: size,
        })),
      };
    }
    const dayId = Number(/\/days\/(\d+)\/photos\//.exec(parsed.pathname)?.[1]);
    const all = Array.from({ length: sizes[dayId] ?? 0 }, (_, n) => photo(dayId, n));
    const after = parsed.searchParams.get("after");
    const start = after === null ? 0 : all.findIndex(p => p.id === after) + 1;
    const items = all.slice(start, start + Number(parsed.searchParams.get("limit") ?? 100));
    const last = items[items.length - 1];
    return { items, next: last && start + items.length < all.length ? last.id : null };
  };
}

const hashes = (chunk: endpoints.DateAlbumPhotosChunk) => chunk.photos.map(p => p.image_hash);

describe("fetchDateAlbumPhotosChunk", () => {
  it("continues a day that grew since the list was read before the next day", async () => {
    // The list counted day 2 at 2 photos; it holds 150 now.
    const { client } = fakeServerByUrl(dayServer({ 1: 1, 2: 150, 3: 1 }));
    const groups = [day(1, 1), day(2, 2), day(3, 1)];
    const first = await endpoints.fetchDateAlbumPhotosChunk(client, groups, { group: 0, after: null });
    expect(hashes(first)).toEqual(["hash1-0", ...Array.from({ length: 100 }, (_, n) => `hash2-${n}`)]);
    expect(first.next).toEqual({ group: 1, after: photo(2, 99).id });
    const second = await endpoints.fetchDateAlbumPhotosChunk(client, groups, defined(first.next));
    expect(hashes(second).slice(0, 2)).toEqual(["hash2-100", "hash2-101"]);
    expect(hashes(second)).toHaveLength(50);
  });

  it("reads small days at once, keeping the list order, and ends at the end of the list", async () => {
    let answer = () => {};
    const held = new Promise<void>(resolve => {
      answer = resolve;
    });
    const { client, requests } = heldServerByUrl(dayServer({ 1: 1, 2: 2, 3: 1 }), held);
    const groups = [day(1, 1), day(2, 2), day(3, 1)];
    const pending = endpoints.fetchDateAlbumPhotosChunk(client, groups, { group: 0, after: null }, { person: 7 });
    // Every day page is asked for before the first one is answered.
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    answer();
    const chunk = await pending;
    expect(hashes(chunk)).toEqual(["hash1-0", "hash2-0", "hash2-1", "hash3-0"]);
    expect(chunk.next).toBeNull();
    expect(requests.map(r => r.url)).toEqual([
      `${API}/days/1/photos/?person=7&limit=100`,
      `${API}/days/2/photos/?person=7&limit=100`,
      `${API}/days/3/photos/?person=7&limit=100`,
    ]);
  });

  it("stops at about a page of photos and continues with the next day", async () => {
    const { client, requests } = fakeServerByUrl(dayServer({ 1: 30, 2: 40, 3: 30, 4: 30, 5: 1 }));
    const groups = [day(1, 30), day(2, 40), day(3, 30), day(4, 30), day(5, 1)];
    const chunk = await endpoints.fetchDateAlbumPhotosChunk(client, groups, { group: 0, after: null });
    expect(chunk.photos).toHaveLength(100);
    expect(chunk.next).toEqual({ group: 3, after: null });
    expect(requests).toHaveLength(3);
  });

  it("ends the batch with a big day, and the next chunk continues inside it from its next", async () => {
    const { client, requests } = fakeServerByUrl(dayServer({ 1: 1, 2: 250, 3: 1 }));
    const groups = [day(1, 1), day(2, 250), day(3, 1)];
    const first = await endpoints.fetchDateAlbumPhotosChunk(client, groups, { group: 0, after: null });
    expect(first.photos).toHaveLength(101);
    expect(defined(first.photos[100]).image_hash).toBe("hash2-99");
    // Day 3 waits: the page of day 2 may leave photos behind.
    expect(requests).toHaveLength(2);
    expect(first.next).toEqual({ group: 1, after: photo(2, 99).id });

    const second = await endpoints.fetchDateAlbumPhotosChunk(client, groups, defined(first.next));
    expect(hashes(second)).toEqual(Array.from({ length: 100 }, (_, n) => `hash2-${100 + n}`));
    expect(second.next).toEqual({ group: 1, after: photo(2, 199).id });

    const third = await endpoints.fetchDateAlbumPhotosChunk(client, groups, defined(second.next));
    expect(third.photos).toHaveLength(50);
    expect(third.next).toEqual({ group: 2, after: null });

    const last = await endpoints.fetchDateAlbumPhotosChunk(client, groups, defined(third.next));
    expect(hashes(last)).toEqual(["hash3-0"]);
    expect(last.next).toBeNull();
    expect(requests.map(r => r.url)).toEqual([
      `${API}/days/1/photos/?limit=100`,
      `${API}/days/2/photos/?limit=100`,
      `${API}/days/2/photos/?after=${photo(2, 99).id}&limit=100`,
      `${API}/days/2/photos/?after=${photo(2, 199).id}&limit=100`,
      `${API}/days/3/photos/?limit=100`,
    ]);
  });

  it("does not fetch a day the list sent whole, and caps the requests of one chunk", async () => {
    const { client, requests } = fakeServerByUrl(dayServer({ 2: 1, 3: 1, 4: 1 }));
    const groups = [day(1, 1, [photo(1, 0)]), day(2, 1), day(3, 1), day(4, 1)];
    const chunk = await endpoints.fetchDateAlbumPhotosChunk(client, groups, { group: 0, after: null }, {}, { requests: 2 });
    expect(hashes(chunk)).toEqual(["hash1-0", "hash2-0"]);
    expect(chunk.next).toEqual({ group: 2, after: null });
    expect(requests.map(r => r.url)).toEqual([`${API}/days/2/photos/?limit=100`]);
  });

  it("answers nothing for an empty list", async () => {
    const { client, requests } = fakeServerByUrl(() => ({}));
    const chunk = await endpoints.fetchDateAlbumPhotosChunk(client, [], { group: 0, after: null });
    expect(chunk).toEqual({ photos: [], next: null });
    expect(requests).toHaveLength(0);
  });
});

describe("date-album photo chunks query", () => {
  it("reads the list with the first chunk and carries it to the next", async () => {
    const { client, requests } = fakeServerByUrl(dayServer({ 4: 150, 5: 2 }));
    const options = dateAlbumPhotoChunksQueryOptions(client, Photoset.PERSON, { person: 3 });
    const queryClient = new QueryClient();
    const data = await queryClient.infiniteQuery(options);
    const first = defined(data.pages[0]);
    expect(first.groups.map(g => g.id)).toEqual([4, 5]);
    expect(first.groups.every(g => g.incomplete && g.items.length === 0)).toBe(true);
    expect(first.photos).toHaveLength(100);
    expect(defined(requests[0]).url).toBe(`${API}/days/?person=3`);
    expect(defined(requests[1]).url).toBe(`${API}/days/4/photos/?person=3&limit=100`);
    expect(options.getNextPageParam(first, data.pages, null, data.pageParams)).toEqual({
      groups: first.groups,
      cursor: { group: 0, after: photo(4, 99).id },
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
