import type { AutoAlbumInfo, PlaceAlbumInfo, UserAlbumInfo } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { sortAlbums } from "./albumSort";
import { eventSortConfig, PEOPLE_SORT, PLACE_SORT, USER_ALBUM_SORT } from "./albumSortConfigs";

// What each album list sorts by (#620), and that every default is the page's order before.

const userAlbum = (title: string, first_photo_date?: string | null): UserAlbumInfo => ({
  id: title.length,
  title,
  cover_photo: null,
  photo_count: 1,
  owner: { id: 1, username: "admin", first_name: "", last_name: "" },
  shared_to: [],
  created_on: "2024-01-01T00:00:00Z",
  favorited: false,
  locked: false,
  collection_ids: [],
  ...(first_photo_date === undefined ? {} : { first_photo_date }),
});

describe("My Albums", () => {
  const byDate = { key: "date", direction: "asc" } as const;

  it("sorts by the oldest photo, albums without one last", () => {
    const albums = [
      userAlbum("Empty", null),
      userAlbum("Recent", "2024-05-01T10:00:00Z"),
      userAlbum("Old", "2003-05-01T10:00:00Z"),
    ];
    expect(sortAlbums(albums, USER_ALBUM_SORT.options, byDate).map(album => album.title)).toEqual([
      "Old",
      "Recent",
      "Empty",
    ]);
  });

  it("offers the date only when the server sends it", () => {
    const date = USER_ALBUM_SORT.options.find(option => option.key === "date");
    expect(date?.isAvailable?.([userAlbum("Older server")])).toBe(false);
    expect(date?.isAvailable?.([userAlbum("Empty", null)])).toBe(true);
  });
});

describe("Events", () => {
  const event = (id: number, title: string, start: string): AutoAlbumInfo => ({
    id,
    title,
    timestamp: start,
    start,
    photos: { image_hash: `h${id}`, video: false },
    photo_count: id,
    favorited: false,
  });

  it("are newest first by default, and sort by the title the cards show", () => {
    const config = eventSortConfig(album => album.title.toUpperCase());
    const events = [event(1, "b", "2020-01-01T00:00:00Z"), event(2, "a", "2022-01-01T00:00:00Z")];
    expect(sortAlbums(events, config.options, config.defaultSort).map(album => album.id)).toEqual([2, 1]);
    expect(sortAlbums(events, config.options, { key: "name", direction: "asc" }).map(album => album.id)).toEqual([
      2, 1,
    ]);
  });
});

describe("Places", () => {
  const place = (title: string, geolocation_level: number, photo_count: number): PlaceAlbumInfo => ({
    id: photo_count,
    title,
    geolocation_level,
    photo_count,
    cover_photos: [],
  });

  it("put countries first and then the places with the most photos by default, as before", () => {
    const places = [place("Berlin", 3, 50), place("France", 1, 10), place("Germany", 1, 80)];
    expect(sortAlbums(places, PLACE_SORT.options, PLACE_SORT.defaultSort).map(album => album.title)).toEqual([
      "Germany",
      "France",
      "Berlin",
    ]);
  });
});

describe("People", () => {
  it("say faces, not photos, for the count", () => {
    expect(PEOPLE_SORT.options.find(option => option.key === "count")?.label).toBe("albumsort.faces");
  });
});
