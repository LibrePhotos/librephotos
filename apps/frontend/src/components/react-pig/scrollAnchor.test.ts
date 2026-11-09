import { describe, expect, it } from "vitest";
import computeLayoutGroups from "./computeLayoutGroups";
import { anchorShift, findScrollAnchor } from "./scrollAnchor";
import type { GroupedImageItem, ImageItem, PigLayout } from "./types";

const settings = { gridGap: 8, headerSize: "large" as const, breakpoint: 800, groupGapSm: 50, groupGapLg: 50 };

function layOut(groups: GroupedImageItem[]): PigLayout<ImageItem> {
  return {
    grouped: true,
    groups: computeLayoutGroups({ imageData: groups, settings, wrapperWidth: 1600, scaleOfImages: 1 }).imageData,
  };
}

const tiles = (prefix: string, count: number, aspectRatio = 1): ImageItem[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, aspectRatio }));

describe("scroll anchor", () => {
  it("keeps the photo at the top of the screen where it was when a day above loads", () => {
    const before = layOut([
      { id: 1, date: "2024-05-02", items: tiles("a", 40) },
      { id: 2, date: "2024-05-01", items: tiles("b", 400) },
    ]);
    // The day above loads: its photos are landscape, fewer to a row, so it gets taller.
    const after = layOut([
      { id: 1, date: "2024-05-02", items: tiles("a", 40, 1.5) },
      { id: 2, date: "2024-05-01", items: tiles("b", 400) },
    ]);
    const viewTop = 10_000;
    const anchor = findScrollAnchor(before, viewTop);
    expect(anchor?.groupKey).toBe("id:2");
    const shift = anchor ? anchorShift(after, anchor) : 0;
    expect(shift).toBeGreaterThan(0);
    const index = anchor?.index ?? -1;
    const beforeGroup = before.grouped ? before.groups[1] : undefined;
    const afterGroup = after.grouped ? after.groups[1] : undefined;
    const tileBefore = beforeGroup?.items[index];
    const tileAfter = afterGroup?.items[index];
    // The same photo, moved by exactly the shift: scrolling by it keeps it still on screen.
    expect(tileAfter?.id).toBe(tileBefore?.id);
    expect((tileAfter?.style.translateY ?? 0) - (tileBefore?.style.translateY ?? 0)).toBe(shift);
  });

  it("follows a photo by its index in a day when that day's own placeholders change shape", () => {
    const before = layOut([{ id: 9, date: null, items: tiles("t", 2000) }]);
    const after = layOut([{ id: 9, date: null, items: tiles("t", 2000, 1.5) }]);
    const anchor = findScrollAnchor(before, 50_000);
    expect(anchor).not.toBeNull();
    if (!anchor || !after.grouped) return;
    const tile = after.groups[0]?.items[anchor.index];
    expect(anchorShift(after, anchor)).toBe((tile?.style.translateY ?? 0) - anchor.tileTop);
  });

  it("does nothing at the top of the grid or when the group is gone", () => {
    const layout = layOut([{ id: 1, date: "2024-05-02", items: tiles("a", 40) }]);
    expect(findScrollAnchor(layout, 0)).toBeNull();
    const anchor = findScrollAnchor(layout, 500);
    expect(anchor).not.toBeNull();
    if (!anchor) return;
    expect(anchorShift(layOut([{ id: 2, date: "2024-05-03", items: tiles("c", 40) }]), anchor)).toBe(0);
  });

  it("anchors a flat list by index", () => {
    const flat = (ratio: number): PigLayout<ImageItem> => ({
      grouped: false,
      tiles: tiles("f", 300, ratio).map((tile, i) => ({
        ...tile,
        style: { width: 100, height: 100 * ratio, translateX: 0, translateY: i * 100 * ratio },
      })),
    });
    const anchor = findScrollAnchor(flat(1), 5_050);
    expect(anchor?.index).toBe(50);
    expect(anchor ? anchorShift(flat(2), anchor) : 0).toBe(5_000);
  });
});
