import { sheetGeometry, snapTarget } from "@/components/BottomSheet";
import { containedRect, faceRect } from "./FaceOverlay";
import { latToTileY, lonToTileX, mapsAppUrl, tileLayout, tileUrl } from "./MapPreview";
import { parseEditableTimestamp, toEditableTimestamp } from "./timestamp";

describe("bottom-sheet detents", () => {
  const geometry = sheetGeometry(844); // iPhone 14-ish

  it("orders the detents from off-screen to fully open", () => {
    expect(geometry.offsets.hidden).toBeGreaterThan(geometry.offsets.peek);
    expect(geometry.offsets.peek).toBeGreaterThan(geometry.offsets.full);
    expect(geometry.offsets.full).toBe(0);
  });

  it("snaps a slow drag to the nearest detent", () => {
    expect(snapTarget(geometry, geometry.offsets.peek + 8, 0)).toBe("peek");
    expect(snapTarget(geometry, geometry.offsets.full + 20, 0)).toBe("full");
    expect(snapTarget(geometry, geometry.offsets.hidden - 10, 0)).toBe("hidden");
  });

  /**
   * Without velocity projection a flick lands wherever the finger happened to
   * lift, which on a fast gesture is nowhere near where the user aimed.
   */
  it("carries a flick one detent further in its direction", () => {
    expect(snapTarget(geometry, geometry.offsets.peek, 1500)).toBe("hidden");
    expect(snapTarget(geometry, geometry.offsets.peek, -1500)).toBe("full");
  });

  it("never overshoots past the ends", () => {
    expect(snapTarget(geometry, geometry.offsets.hidden, 2000)).toBe("hidden");
    expect(snapTarget(geometry, geometry.offsets.full, -2000)).toBe("full");
  });
});

describe("face overlay geometry", () => {
  it("letterboxes a wide photo inside a tall slide", () => {
    const rect = containedRect(4000, 2000, 400, 800);
    expect(rect).toEqual({ left: 0, top: 300, width: 400, height: 200 });
  });

  it("pillarboxes a tall photo inside a wide slide", () => {
    const rect = containedRect(1000, 2000, 800, 400);
    expect(rect).toEqual({ left: 300, top: 0, width: 200, height: 400 });
  });

  it("returns null rather than dividing by a missing dimension", () => {
    expect(containedRect(null, 2000, 400, 800)).toBeNull();
    expect(containedRect(4000, 0, 400, 800)).toBeNull();
    expect(containedRect(4000, 2000, 0, 800)).toBeNull();
  });

  it("maps a source-pixel face box onto the rendered image", () => {
    // 4000x2000 photo in a 400x800 slide → rendered 400x200 at y=300.
    const rect = faceRect({ left: 1000, right: 2000, top: 500, bottom: 1000 }, 4000, 2000, 400, 800);
    expect(rect).toEqual({ left: 100, top: 300 + 50, width: 100, height: 50 });
  });

  /**
   * Some detectors emit normalized boxes. Treating those as pixels would draw a
   * one-pixel box in the corner, which looks like a rendering bug rather than a
   * data difference.
   */
  it("accepts a normalized face box", () => {
    const rect = faceRect({ left: 0.25, right: 0.5, top: 0.25, bottom: 0.5 }, 4000, 2000, 400, 800);
    expect(rect).toEqual({ left: 100, top: 350, width: 100, height: 50 });
  });

  it("rejects an inside-out box", () => {
    expect(faceRect({ left: 200, right: 100, top: 0, bottom: 10 }, 400, 400, 100, 100)).toBeNull();
  });
});

describe("map tile layout", () => {
  it("agrees with the Web Mercator reference values", () => {
    // Greenwich at zoom 0 sits at the centre of the single world tile.
    expect(lonToTileX(0, 0)).toBeCloseTo(0.5, 6);
    expect(latToTileY(0, 0)).toBeCloseTo(0.5, 6);
    expect(lonToTileX(-180, 1)).toBeCloseTo(0, 6);
    expect(lonToTileX(180, 1)).toBeCloseTo(2, 6);
  });

  it("clamps beyond the Mercator limit instead of producing infinities", () => {
    expect(Number.isFinite(latToTileY(90, 10))).toBe(true);
    expect(Number.isFinite(latToTileY(-90, 10))).toBe(true);
  });

  it("covers the viewport and places the centre tile over the pin", () => {
    const layout = tileLayout({ lat: 52.52, lon: 13.405, width: 320, height: 160 });
    expect(layout.tiles.length).toBeGreaterThan(0);
    // Every tile overlaps the viewport it was computed for.
    for (const tile of layout.tiles) {
      expect(tile.left).toBeLessThan(320);
      expect(tile.top).toBeLessThan(160);
      expect(tile.left + layout.size).toBeGreaterThan(0);
      expect(tile.top + layout.size).toBeGreaterThan(0);
    }
    // The pin is drawn dead-centre, so some tile must cover that point.
    const covers = layout.tiles.some(
      (tile) =>
        tile.left <= 160 &&
        tile.left + layout.size >= 160 &&
        tile.top <= 80 &&
        tile.top + layout.size >= 80
    );
    expect(covers).toBe(true);
  });

  it("wraps longitude across the antimeridian rather than leaving a gap", () => {
    const layout = tileLayout({ lat: 0, lon: 179.999, zoom: 2, width: 600, height: 120 });
    // x is always a legal tile index for the zoom (0..3 at z=2).
    for (const tile of layout.tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(4);
    }
  });

  it("builds the same OSM tile URL the web frontend's osm style uses", () => {
    expect(tileUrl({ x: 1, y: 2, z: 3, left: 0, top: 0 })).toBe(
      "https://tile.openstreetmap.org/3/1/2.png"
    );
  });

  it("hands coordinates to the platform maps app", () => {
    expect(mapsAppUrl(52.5, 13.4, "Berlin")).toContain("52.5,13.4");
  });
});

describe("timestamp editing", () => {
  it("round-trips a local timestamp through the edit field", () => {
    const ms = new Date(2024, 0, 3, 10, 5, 9).getTime();
    expect(toEditableTimestamp(ms)).toBe("2024-01-03 10:05:09");
    expect(parseEditableTimestamp("2024-01-03 10:05:09")).toBe("2024-01-03T10:05:09");
  });

  it("accepts the server's own naive ISO form", () => {
    expect(toEditableTimestamp("2024-01-03T10:00:00")).toBe("2024-01-03 10:00:00");
  });

  it("defaults the seconds and tolerates a T separator", () => {
    expect(parseEditableTimestamp("2024-01-03T10:05")).toBe("2024-01-03T10:05:00");
  });

  /**
   * `new Date(2024, 1, 31)` silently becomes 2 March. Saving that would move
   * the photo two days without telling anyone, so an impossible date is a
   * validation failure, not a rounding.
   */
  it("rejects impossible dates instead of rolling them over", () => {
    expect(parseEditableTimestamp("2024-02-31 10:00:00")).toBeNull();
    expect(parseEditableTimestamp("2024-13-01 10:00:00")).toBeNull();
    expect(parseEditableTimestamp("2024-01-03 25:00:00")).toBeNull();
    expect(parseEditableTimestamp("yesterday")).toBeNull();
    expect(parseEditableTimestamp("")).toBeNull();
  });

  it("renders an absent timestamp as an empty field, not as 1970", () => {
    expect(toEditableTimestamp(null)).toBe("");
    expect(toEditableTimestamp(undefined)).toBe("");
    expect(toEditableTimestamp("not a date")).toBe("");
  });
});
