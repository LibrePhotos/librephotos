/**
 * Trashing a photo reloaded every day list, which put every day back to placeholders and refilled
 * them one visible day at a time: seconds on a big library, during which a lightbox open over the
 * list had nowhere to step. The photo is now taken out of the cached lists in place.
 */
import { photoGridKeys, Photoset, type DateAlbumsListKey, type PigPhoto } from "@librephotos/api-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { tempPigPhoto } from "../../util/util";
import { applyTrashToggleToGrids, dayWithout } from "./removeFromDateAlbums";

const photo = (hash: string): PigPhoto => ({ ...tempPigPhoto(`id-${hash}`), image_hash: hash, isTemp: false });
const day = (id: number, items: PigPhoto[], numberOfItems = items.length) => ({
  id,
  date: "2024-05-01",
  location: "",
  incomplete: true,
  numberOfItems,
  items,
});
const timeline: DateAlbumsListKey = [Photoset.NONE, undefined, undefined, undefined, "all", ""];
const trash: DateAlbumsListKey = [Photoset.IN_TRASHCAN, undefined, undefined, undefined, "all", ""];

describe("dayWithout", () => {
  it("leaves a day without the photo alone", () => {
    expect(dayWithout(day(1, [photo("a")]), new Set(["x"]))).toBeNull();
  });

  it("takes the photo out, counts it, and renumbers the placeholders behind it", () => {
    const loaded = Array.from({ length: 100 }, (_, i) => photo(`p${i}`));
    const placeholders = Array.from({ length: 50 }, (_, i) => tempPigPhoto(String(100 + i)));

    const result = defined(dayWithout(day(1, [...loaded, ...placeholders]), new Set(["p3"])));

    expect(result.firstPage).toBe(1);
    expect(result.group.numberOfItems).toBe(149);
    expect(result.group.items.map(item => item.image_hash)).not.toContain("p3");
    // The first placeholder is now the 100th item, the last of page 1: that page is loaded again.
    expect(result.group.items[99]).toMatchObject({ id: "99", isTemp: true });
  });

  it("names the page the first removed photo was on", () => {
    const items = Array.from({ length: 150 }, (_, i) => photo(`p${i}`));

    expect(dayWithout(day(1, items), new Set(["p120"]))?.firstPage).toBe(2);
  });
});

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

function cacheWith(client: QueryClient) {
  const list = photoGridKeys.dateAlbumList(timeline);
  const day1 = photoGridKeys.dateAlbumDay(timeline, 1, 1);
  const day1Page2 = photoGridKeys.dateAlbumDay(timeline, 1, 2);
  const day2 = photoGridKeys.dateAlbumDay(timeline, 2, 1);
  const trashList = photoGridKeys.dateAlbumList(trash);
  const album = photoGridKeys.userAlbumView("7", false, "alice", "all");
  client.setQueryData(list, [day(1, [photo("a"), photo("b")]), day(2, [photo("c")])]);
  client.setQueryData(day1, day(1, [photo("a"), photo("b")]));
  client.setQueryData(day1Page2, day(1, []));
  client.setQueryData(day2, day(2, [photo("c")]));
  client.setQueryData(trashList, []);
  client.setQueryData(album, []);
  return { list, day1, day1Page2, day2, trashList, album };
}

describe("applyTrashToggleToGrids", () => {
  it("takes a trashed photo out of the day lists in place, without reloading them", () => {
    const client = new QueryClient();
    const keys = cacheWith(client);

    applyTrashToggleToGrids(client, { image_hashes: ["b", "c"] }, true);

    const list = client.getQueryData<ReturnType<typeof day>[]>(keys.list);
    expect(list?.map(group => group.items.map(item => item.image_hash))).toEqual([["a"]]);
    expect(list?.[0]?.numberOfItems).toBe(1);
    expect(client.getQueryState(keys.list)?.isInvalidated).toBe(false);
  });

  it("drops the day pages that held it, and the pages after them in that day", () => {
    const client = new QueryClient();
    const keys = cacheWith(client);

    applyTrashToggleToGrids(client, { image_hashes: ["b"] }, true);

    expect(client.getQueryData(keys.day1)).toBeUndefined();
    expect(client.getQueryData(keys.day1Page2)).toBeUndefined();
    expect(client.getQueryData(keys.day2)).toBeDefined();
  });

  it("refreshes the trash, which the photo joins, and every other kind of grid", () => {
    const client = new QueryClient();
    const keys = cacheWith(client);

    applyTrashToggleToGrids(client, { image_hashes: ["b"] }, true);

    expect(client.getQueryState(keys.trashList)?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.album)?.isInvalidated).toBe(true);
  });

  it("on a restore, takes the photo out of the trash and refreshes the timeline instead", () => {
    const client = new QueryClient();
    const trashList = photoGridKeys.dateAlbumList(trash);
    const list = photoGridKeys.dateAlbumList(timeline);
    client.setQueryData(trashList, [day(5, [photo("b")])]);
    client.setQueryData(list, [day(1, [photo("a")])]);

    applyTrashToggleToGrids(client, { image_hashes: ["b"] }, false);

    expect(client.getQueryData(trashList)).toEqual([]);
    expect(client.getQueryState(list)?.isInvalidated).toBe(true);
  });

  it("refreshes everything for a server-side select all, which names no photos", () => {
    const client = new QueryClient();
    const keys = cacheWith(client);

    applyTrashToggleToGrids(client, { select_all: true, query: {} }, true);

    expect(client.getQueryState(keys.list)?.isInvalidated).toBe(true);
  });
});
