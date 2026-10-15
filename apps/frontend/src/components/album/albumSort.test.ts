import { describe, expect, it } from "vitest";
import { sameSort, sortAlbums, sortForKey } from "./albumSort";
import type { AlbumSortOption } from "./albumSort";

// Sorting the album lists (#620): a sorted copy, missing values last, ties by count then name.

type Album = Readonly<{ title: string; photo_count: number; date?: number | null }>;

const options: AlbumSortOption<Album>[] = [
  { key: "name", value: album => album.title },
  { key: "count", value: album => album.photo_count },
  { key: "date", value: album => album.date },
];

const titles = (albums: readonly Album[]) => albums.map(album => album.title);

describe("sortAlbums", () => {
  it("sorts names in natural order, ignoring case and accents", () => {
    const albums = [
      { title: "album 10", photo_count: 1 },
      { title: "Ölberg", photo_count: 1 },
      { title: "Album 2", photo_count: 1 },
      { title: "berlin", photo_count: 1 },
    ];
    expect(titles(sortAlbums(albums, options, { key: "name", direction: "asc" }))).toEqual([
      "Album 2",
      "album 10",
      "berlin",
      "Ölberg",
    ]);
    expect(titles(sortAlbums(albums, options, { key: "name", direction: "desc" }))).toEqual([
      "Ölberg",
      "berlin",
      "album 10",
      "Album 2",
    ]);
  });

  it("breaks a tie on the count by name, and a tie on the name by count", () => {
    const albums = [
      { title: "B", photo_count: 5 },
      { title: "A", photo_count: 5 },
      { title: "C", photo_count: 9 },
    ];
    expect(titles(sortAlbums(albums, options, { key: "count", direction: "desc" }))).toEqual(["C", "A", "B"]);
    expect(titles(sortAlbums(albums, options, { key: "count", direction: "asc" }))).toEqual(["A", "B", "C"]);

    const twins = [
      { title: "Same", photo_count: 1, date: 1 },
      { title: "Same", photo_count: 7, date: 2 },
    ];
    expect(sortAlbums(twins, options, { key: "name", direction: "asc" }).map(album => album.date)).toEqual([2, 1]);
  });

  it("puts an album without a value last in either direction", () => {
    const albums = [
      { title: "undated", photo_count: 1, date: null },
      { title: "old", photo_count: 1, date: 100 },
      { title: "unknown", photo_count: 1, date: Number.NaN },
      { title: "new", photo_count: 1, date: 200 },
    ];
    expect(titles(sortAlbums(albums, options, { key: "date", direction: "desc" }))).toEqual([
      "new",
      "old",
      "undated",
      "unknown",
    ]);
    expect(titles(sortAlbums(albums, options, { key: "date", direction: "asc" }))).toEqual([
      "old",
      "new",
      "undated",
      "unknown",
    ]);
  });

  it("returns a copy and leaves the list it was given alone", () => {
    const albums = [
      { title: "B", photo_count: 1 },
      { title: "A", photo_count: 2 },
    ];
    const sorted = sortAlbums(albums, options, { key: "name", direction: "asc" });
    expect(titles(sorted)).toEqual(["A", "B"]);
    expect(titles(albums)).toEqual(["B", "A"]);
    expect(sorted).not.toBe(albums);
  });

  it("keeps the order it was given for a key the page does not offer", () => {
    const albums = [
      { title: "B", photo_count: 1 },
      { title: "A", photo_count: 1 },
    ];
    expect(titles(sortAlbums(albums, options.slice(0, 1), { key: "size", direction: "asc" }))).toEqual(["A", "B"]);
    expect(titles(sortAlbums(albums, [], { key: "size", direction: "asc" }))).toEqual(["B", "A"]);
  });
});

describe("sortForKey", () => {
  const defaultSort = { key: "name", direction: "asc" } as const;

  it("starts a key in its natural direction", () => {
    expect(sortForKey("count", defaultSort, defaultSort)).toEqual({ key: "count", direction: "desc" });
    expect(sortForKey("date", defaultSort, defaultSort)).toEqual({ key: "date", direction: "desc" });
    expect(sortForKey("size", defaultSort, defaultSort)).toEqual({ key: "size", direction: "asc" });
  });

  it("keeps the direction when the current key is picked again, and the default's for the default key", () => {
    const current = { key: "count", direction: "asc" } as const;
    expect(sortForKey("count", current, defaultSort)).toBe(current);
    expect(sortForKey("name", current, { key: "name", direction: "desc" })).toEqual({ key: "name", direction: "desc" });
  });
});

describe("sameSort", () => {
  it("compares the key and the direction", () => {
    expect(sameSort({ key: "name", direction: "asc" }, { key: "name", direction: "asc" })).toBe(true);
    expect(sameSort({ key: "name", direction: "asc" }, { key: "name", direction: "desc" })).toBe(false);
    expect(sameSort({ key: "name", direction: "asc" }, { key: "count", direction: "asc" })).toBe(false);
  });
});
