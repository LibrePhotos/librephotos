import { describe, expect, test } from "vitest";
import { tagOptionsFilter } from "./tagOptionsFilter";

const options = ["Alberta", "beach", "Beachcomber", "holiday", "seaside beach"].map(name => ({
  value: name,
  label: name,
}));

const filter = (search: string, limit = Infinity) =>
  (tagOptionsFilter({ options, search, limit }) as { label: string }[]).map(item => item.label);

describe("tagOptionsFilter", () => {
  test("puts names starting with the query first", () => {
    // Mantine's default filter would have led with Alberta, because the list
    // is alphabetical and it matches anywhere in the name.
    expect(filter("be")).toEqual(["beach", "Beachcomber", "Alberta", "seaside beach"]);
  });

  test("is case-insensitive in both directions", () => {
    // "Alberta" holds "ber", not "bea", so it drops out entirely here.
    expect(filter("BEA")).toEqual(["beach", "Beachcomber", "seaside beach"]);
  });

  test("still finds a name that only contains the query", () => {
    expect(filter("side")).toEqual(["seaside beach"]);
  });

  test("ignores surrounding whitespace in the query", () => {
    expect(filter("  holi ")).toEqual(["holiday"]);
  });

  test("offers everything when nothing has been typed", () => {
    expect(filter("")).toEqual(["Alberta", "beach", "Beachcomber", "holiday", "seaside beach"]);
  });

  test("keeps the prefix matches when the limit cuts the list short", () => {
    expect(filter("bea", 2)).toEqual(["beach", "Beachcomber"]);
  });

  test("returns nothing for a query no tag matches", () => {
    expect(filter("zzz")).toEqual([]);
  });
});
