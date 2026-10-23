import type { DatePhotosGroup, PigPhoto } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { orderDateGroups, withOrderedGroups } from "./photoOrder";
import { LEGACY_UNDATED_GROUP_DATE, tempPigPhoto } from "./util";

const photo = (id: string): PigPhoto => ({ ...tempPigPhoto(id), image_hash: id, isTemp: false });

const group = (date: string | null, ids: string[]): DatePhotosGroup => ({
  date,
  location: "",
  items: ids.map(photo),
});

const shape = (groups: DatePhotosGroup[]) => groups.map(g => [g.date, g.items.map(item => item.id)]);

// As the server sends them: newest day first, each day's photos newest first, the undated last.
const newestFirst = [
  group("2024-05-03T18:00:00Z", ["c2", "c1"]),
  group("2024-05-02T09:00:00Z", ["b1"]),
  group("2024-05-01T12:00:00Z", ["a3", "a2", "a1"]),
  group(null, ["u1", "u2"]),
];

describe("orderDateGroups", () => {
  it("returns the groups themselves for newest first", () => {
    expect(orderDateGroups(newestFirst, "newest")).toBe(newestFirst);
  });

  it("reverses the days and their photos for oldest first, the undated group last as it came", () => {
    expect(shape(orderDateGroups(newestFirst, "oldest"))).toEqual([
      ["2024-05-01T12:00:00Z", ["a1", "a2", "a3"]],
      ["2024-05-02T09:00:00Z", ["b1"]],
      ["2024-05-03T18:00:00Z", ["c1", "c2"]],
      [null, ["u1", "u2"]],
    ]);
  });

  it("keeps the search page's legacy undated group last too", () => {
    const groups = [
      group("2024-05-02T09:00:00Z", ["b"]),
      group(LEGACY_UNDATED_GROUP_DATE, ["u"]),
      group("2024-05-01T09:00:00Z", ["a"]),
    ];
    expect(shape(orderDateGroups(groups, "oldest")).map(([date]) => date)).toEqual([
      "2024-05-01T09:00:00Z",
      "2024-05-02T09:00:00Z",
      LEGACY_UNDATED_GROUP_DATE,
    ]);
  });

  it("leaves the answer it was given alone", () => {
    orderDateGroups(newestFirst, "oldest");
    expect(shape(newestFirst)[0]).toEqual(["2024-05-03T18:00:00Z", ["c2", "c1"]]);
  });
});

describe("withOrderedGroups", () => {
  const album = { id: 4, title: "Trip", grouped_photos: newestFirst };

  it("is the album itself for newest first", () => {
    expect(withOrderedGroups(album, "newest")).toBe(album);
  });

  it("orders the album's groups and keeps its other fields", () => {
    const ordered = withOrderedGroups(album, "oldest");
    expect(ordered.title).toBe("Trip");
    expect(ordered.grouped_photos[0]?.date).toBe("2024-05-01T12:00:00Z");
  });
});
