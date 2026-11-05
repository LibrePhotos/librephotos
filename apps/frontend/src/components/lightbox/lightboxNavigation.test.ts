/**
 * Where the lightbox can step. Deleting photos one after another closed it, stepped back, jumped
 * to the top of the timeline or onto a placeholder (`?photo=0`): the grid's list it stepped
 * through was being rebuilt with placeholders after every action.
 */
import { describe, expect, it } from "vitest";
import type { LightboxItem } from "./lightbox.types";
import { adoptsLive, neighbour } from "./lightboxNavigation";

const photo = (id: string): LightboxItem => ({ id, image_hash: `h${id}` });
const placeholder = (id: string): LightboxItem => ({ id, image_hash: "", isTemp: true });
const none: ReadonlySet<string> = new Set();

describe("neighbour", () => {
  const items = [photo("a"), photo("b"), photo("c")];

  it("steps to the photo before and after", () => {
    expect(neighbour(items, 1, -1, none)?.id).toBe("a");
    expect(neighbour(items, 1, 1, none)?.id).toBe("c");
  });

  it("stops at either end instead of wrapping around", () => {
    expect(neighbour(items, 0, -1, none)).toBeNull();
    expect(neighbour(items, 2, 1, none)).toBeNull();
  });

  it("has no neighbours for a photo not in the list, rather than the list's first", () => {
    expect(neighbour(items, -1, 1, none)).toBeNull();
    expect(neighbour(items, -1, -1, none)).toBeNull();
  });

  it("passes over the photos trashed in this lightbox", () => {
    expect(neighbour(items, 0, 1, new Set(["b"]))?.id).toBe("c");
    expect(neighbour(items, 2, -1, new Set(["b", "a"]))).toBeNull();
  });

  it("stops at a placeholder: the photos behind it are not known yet", () => {
    expect(neighbour([photo("a"), placeholder("1"), photo("c")], 0, 1, none)).toBeNull();
  });
});

describe("adoptsLive", () => {
  const known = { items: [photo("a"), photo("b"), photo("c")], index: 1 };

  it("takes the first list that holds the photo", () => {
    expect(adoptsLive({ items: known.items, index: 1 }, null, none)).toBe(true);
  });

  it("keeps the known list while the grid's has lost the photo (it was just trashed)", () => {
    expect(adoptsLive({ items: [photo("a"), photo("c")], index: -1 }, known, none)).toBe(false);
  });

  it("keeps it while the grid's list has placeholders where the neighbours were", () => {
    const refilling = { items: [placeholder("0"), photo("b"), placeholder("2")], index: 1 };

    expect(adoptsLive(refilling, known, none)).toBe(false);
  });

  it("takes the grid's list once it is back, with whatever changed in it", () => {
    const refilled = { items: [photo("a"), photo("b"), photo("x"), photo("c")], index: 1 };

    expect(adoptsLive(refilled, known, none)).toBe(true);
  });

  it("does not hold on to a neighbour that was trashed here", () => {
    const live = { items: [photo("b"), photo("c")], index: 0 };

    expect(adoptsLive(live, known, new Set(["a"]))).toBe(true);
  });
});
