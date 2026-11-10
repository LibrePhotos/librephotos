/**
 * The photo list's selection as one state at a time (off, some photos, or select all by a query).
 * It used to be flags: `selectedItems` meant the picked or the excluded photos depending on
 * `selectAllMode`, and every bulk action sent `selectAllQuery ?? {}`, an empty query that matches
 * the whole library (trash restore and permanent delete included).
 */
import { PigPhoto } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { tempPigPhoto } from "../../util/util";
import {
  nextSelection,
  rangeAnchor,
  selectedCount,
  selectedOf,
  selectedTiles,
  SELECTION_OFF,
  toPhotoSelection,
} from "./photoListSelection";
import type { ListSelection, SelectionEvent } from "./photoListSelection";

const photo = (n: number) =>
  PigPhoto.parse({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, image_hash: `h${n}`, aspectRatio: 1 });
const [a, b, c] = [photo(1), photo(2), photo(3)];
const placeholder = tempPigPhoto("temp-9");

const run = (...events: SelectionEvent[]) => events.reduce(nextSelection, SELECTION_OFF);
const ids = (selection: ListSelection) => selectedTiles(selection, [a, b, c, placeholder]).map(item => item.image_hash);

describe("nextSelection", () => {
  it("ends a selection started by ticking a tile with its last tile", () => {
    expect(run({ type: "toggle", item: a }, { type: "toggle", item: a })).toEqual(SELECTION_OFF);
  });

  it("keeps select mode the Select button opened when the last tile is unticked", () => {
    const selection = run({ type: "enter" }, { type: "toggle", item: a }, { type: "toggle", item: a });
    expect(selection).toEqual({ kind: "some", items: [], keepOpen: true });
  });

  it("never takes in a placeholder, by click, range, or select loaded", () => {
    expect(run({ type: "toggle", item: placeholder })).toEqual(SELECTION_OFF);
    expect(ids(run({ type: "addRange", items: [a, placeholder] }))).toEqual(["h1"]);
    expect(ids(run({ type: "selectLoaded", items: [a, b, placeholder] }))).toEqual(["h1", "h2"]);
    const all = run({ type: "selectAll", query: { favorite: true } }, { type: "toggle", item: placeholder });
    expect(all).toEqual({ kind: "all", query: { favorite: true }, excluded: [] });
  });

  it("adds a range without picking a photo twice", () => {
    const selection = run({ type: "toggle", item: a }, { type: "addRange", items: [a, b] });
    expect(ids(selection)).toEqual(["h1", "h2"]);
    expect(rangeAnchor(selection)).toBe(b);
  });

  it("after select all, a click or range leaves photos out and a second click takes one back", () => {
    const selection = run(
      { type: "selectAll", query: { person: 4 } },
      { type: "toggle", item: a },
      { type: "addRange", items: [b, c] },
      { type: "toggle", item: c }
    );
    expect(ids(selection)).toEqual(["h3"]);
    expect(toPhotoSelection(selectedOf(selection, 10))).toEqual({
      select_all: true,
      query: { person: 4 },
      excluded_hashes: ["h1", "h2"],
    });
    expect(selectedCount(selectedOf(selection, 10))).toBe(8);
  });

  it("Deselect all keeps select mode open; clear ends it", () => {
    const selection = run({ type: "selectAll", query: { favorite: true } }, { type: "deselectAll" });
    expect(selection).toEqual({ kind: "some", items: [], keepOpen: true });
    expect(nextSelection(selection, { type: "clear" })).toEqual(SELECTION_OFF);
  });
});

describe("selectedOf", () => {
  it("hands the actions the picked photos as hashes, never a query", () => {
    const selected = selectedOf(run({ type: "toggle", item: a }, { type: "toggle", item: b }), 50);
    expect(toPhotoSelection(selected)).toEqual({ image_hashes: ["h1", "h2"] });
    expect(selectedCount(selected)).toBe(2);
  });

  it("counts a select all against the list's live total", () => {
    const selection = run({ type: "selectAll", query: { favorite: true } }, { type: "toggle", item: a });
    expect(selectedCount(selectedOf(selection, 120))).toBe(119);
    expect(selectedCount(selectedOf(selection, 90))).toBe(89);
  });

  it("acts on nothing while off", () => {
    expect(toPhotoSelection(selectedOf(SELECTION_OFF, 5))).toEqual({ image_hashes: [] });
  });
});
