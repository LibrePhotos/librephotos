import { describe, expect, it } from "vitest";
import { nodePoint } from "./placeTreeGeometry";

const polar = { layout: "polar", orientation: "horizontal" } as const;

describe("nodePoint on the radial layout", () => {
  it("puts angle 0 straight up and a quarter turn to the right, as d3's pointRadial does", () => {
    const [upX, upY] = nodePoint({ x: 0, y: 10 }, polar);
    expect(upX).toBeCloseTo(0);
    expect(upY).toBeCloseTo(-10);
    const [rightX, rightY] = nodePoint({ x: Math.PI / 2, y: 10 }, polar);
    expect(rightX).toBeCloseTo(10);
    expect(rightY).toBeCloseTo(0);
  });
});
