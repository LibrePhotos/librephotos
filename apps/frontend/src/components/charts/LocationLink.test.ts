/**
 * Place tree node labels are cut by their measured width, not by a character
 * count: a name that fits stays whole, a longer one ends in "…" within the width.
 *
 * A node's tooltip opens on the side with room and stays inside the window: on a
 * 375px phone, flipping the root's tooltip left put it half outside the window.
 */
import { describe, expect, it } from "vitest";
import { fitLabel, placeTooltip } from "./LocationLink";

// Every glyph 6px wide
const measure = (text: string) => text.length * 6;

describe("fitLabel", () => {
  it("keeps a name that fits", () => {
    expect(fitLabel("Places I've visited", 19 * 6, measure)).toBe("Places I've visited");
  });

  it("cuts a longer name to the width", () => {
    const label = fitLabel("Places I've visited", 54, measure);
    expect(label).toBe("Places I…");
    expect(measure(label)).toBeLessThanOrEqual(54);
  });

  it("leaves no space before the ellipsis", () => {
    expect(fitLabel("Places I've visited", 42, measure)).toBe("Places…");
  });

  it("keeps at least one character", () => {
    expect(fitLabel("Lisbon", 1, measure)).toBe("L…");
  });
});

describe("placeTooltip", () => {
  // Tooltip edges in window coordinates, at its widest
  const edges = ({ x, flip, maxWidth }: ReturnType<typeof placeTooltip>, viewportWidth: number) =>
    flip ? { left: viewportWidth - x - maxWidth, right: viewportWidth - x } : { left: x, right: x + maxWidth };

  it("opens right of a node with room there", () => {
    expect(placeTooltip({ left: 300, right: 440 }, 1440)).toEqual({ x: 448, flip: false, maxWidth: 250 });
  });

  it("opens left of a node near the window's right edge", () => {
    const placed = placeTooltip({ left: 1250, right: 1390 }, 1440);
    expect(placed.flip).toBe(true);
    expect(edges(placed, 1440).right).toBe(1242);
  });

  it("stays right of the phone's root node, where the left side has less room", () => {
    // Measured at 375x812 on /statistics/placetree
    const placed = placeTooltip({ left: 61, right: 201 }, 375);
    expect(placed.flip).toBe(false);
    expect(edges(placed, 375).left).toBeGreaterThan(201);
    expect(edges(placed, 375).right).toBeLessThanOrEqual(375 - 8);
  });

  it("stays inside the window when neither side has room", () => {
    const placed = placeTooltip({ left: 100, right: 300 }, 375);
    expect(edges(placed, 375).left).toBeGreaterThanOrEqual(8);
    expect(edges(placed, 375).right).toBeLessThanOrEqual(375 - 8);
  });
});
