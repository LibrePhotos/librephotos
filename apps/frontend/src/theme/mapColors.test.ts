import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapLayerColors, type MapLayerColors } from "./mapColors";

// The dark-mode map filter as maths. CSS applies each step in sRGB and clamps it to [0, 1].
const BRIGHTNESS = 0.9;
const DARK_MAP_FILTER = `invert(1) hue-rotate(180deg) brightness(${BRIGHTNESS})`;

type Rgb = readonly [number, number, number];

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const eachChannel = ([r, g, b]: Rgb, f: (channel: number) => number): Rgb => [f(r), f(g), f(b)];

function hexToRgb(hex: string): Rgb {
  const digits = hex.length === 4 ? [...hex.slice(1)].map(digit => digit + digit).join("") : hex.slice(1);
  const channel = (offset: number) => parseInt(digits.slice(offset, offset + 2), 16) / 255;
  return [channel(0), channel(2), channel(4)];
}

/** What the browser shows for a canvas pixel of this colour in dark mode. */
function throughDarkMapFilter(hex: string): Rgb {
  const inverted = eachChannel(hexToRgb(hex), channel => 1 - channel);
  const [r, g, b] = inverted;
  // CSS's hue-rotate(180deg) matrix is 2·L − I, with L the projection on its luminance weights
  const twiceLuminance = 2 * (0.213 * r + 0.715 * g + 0.072 * b);
  return eachChannel(inverted, channel => clamp(twiceLuminance - channel) * BRIGHTNESS);
}

/** CIE76 colour difference: about 2.3 is just noticeable, black to white is 100. */
function deltaE(left: Rgb, right: Rgb): number {
  const toLab = (rgb: Rgb) => {
    const [r, g, b] = eachChannel(rgb, c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)] as const;
  };
  const [l1, a1, b1] = toLab(left);
  const [l2, a2, b2] = toLab(right);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const entries = (colors: MapLayerColors): Array<[string, string]> => [
  ["clusters.small", colors.clusters.small],
  ["clusters.medium", colors.clusters.medium],
  ["clusters.large", colors.clusters.large],
  ["clusterText", colors.clusterText],
  ["point", colors.point],
  ["pointStroke", colors.pointStroke],
];

// How far each dark colour may land from its light one. The filter cannot reach a bright yellow
// (its blue channel clamps), so the medium cluster gets the most room; everything else is close.
const TOLERANCE: Record<string, number> = { "clusters.medium": 34 };
const DEFAULT_TOLERANCE = 9;

describe("mapLayerColors", () => {
  it("assumes the filter the map stylesheet applies", () => {
    const css = readFileSync(resolve(__dirname, "../components/map/ThemedMap.module.css"), "utf8");
    expect(css).toContain(`filter: ${DARK_MAP_FILTER};`);
  });

  it("paints the light colours on a light map", () => {
    expect(mapLayerColors("light").point).toBe("#11b4da");
  });

  it("paints colours on a dark map that the filter turns back into the light ones", () => {
    const light = new Map(entries(mapLayerColors("light")));
    const far = entries(mapLayerColors("dark")).flatMap(([name, dark]) => {
      const distance = deltaE(throughDarkMapFilter(dark), hexToRgb(light.get(name) ?? ""));
      return distance <= (TOLERANCE[name] ?? DEFAULT_TOLERANCE) ? [] : [`${name}: ${distance.toFixed(1)}`];
    });
    expect(far).toEqual([]);
  });

  it("keeps the cluster count black on a dark map", () => {
    expect(throughDarkMapFilter(mapLayerColors("dark").clusterText)).toEqual([0, 0, 0]);
  });
});
