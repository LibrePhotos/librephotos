import { describe, expect, it } from "vitest";
import { eotf, linearToOklab, oetf, oklabToLinear, oklchToSrgb8 } from "./oklab";

describe("oklab", () => {
  it("takes white to L 1 and no chroma, and back", () => {
    const [l, a, b] = linearToOklab([1, 1, 1]);
    expect(l).toBeCloseTo(1, 4);
    expect(a).toBeCloseTo(0, 4);
    expect(b).toBeCloseTo(0, 4);
    const back = oklabToLinear([l, a, b]);
    back.forEach(channel => expect(channel).toBeCloseTo(1, 4));
  });

  it("round-trips a colour", () => {
    const colour = [0.6, 0.2, 0.05] as const;
    oklabToLinear(linearToOklab(colour)).forEach((channel, i) => expect(channel).toBeCloseTo(colour[i] ?? 0, 5));
  });

  it("inverts the sRGB transfer", () => {
    for (const e of [0, 0.02, 0.2, 0.5, 1]) expect(oetf(eotf(e))).toBeCloseTo(e, 6);
  });

  it("gives grey without chroma and the hue's colour with it", () => {
    const [r, g, b] = oklchToSrgb8(0.7, 0, 123);
    expect(r).toBe(g);
    expect(g).toBe(b);
    // Hue 29 is the mixer's red band, 262 its blue.
    const red = oklchToSrgb8(0.7, 0.15, 29);
    expect(red[0]).toBeGreaterThan(red[1] + 60);
    const blue = oklchToSrgb8(0.7, 0.15, 262);
    expect(blue[2]).toBeGreaterThan(blue[0] + 60);
  });
});
