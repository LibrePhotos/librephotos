import { describe, expect, it } from "vitest";
import { parseCoordinates } from "./parseCoordinates";

describe("parseCoordinates", () => {
  it.each([
    ["48.8566, 2.3522", 48.8566, 2.3522],
    ["  -33.86,151.21 ", -33.86, 151.21],
    ["52.5163 13.3777", 52.5163, 13.3777],
    ["0, 0", 0, 0],
    ["90, -180", 90, -180],
  ])("reads %j as a position", (text, lat, lon) => {
    expect(parseCoordinates(text)).toEqual({ kind: "position", lat, lon });
  });

  it.each(["90.1, 0", "0, 180.5", "-91 10"])("reads %j as off the globe", text => {
    expect(parseCoordinates(text)).toEqual({ kind: "out_of_range" });
  });

  it.each(["Berlin", "48.85", "48.85, 2.35, 7", "48,85; 2,35", "10115 Berlin", ""])(
    "leaves %j to the place search",
    text => {
      expect(parseCoordinates(text)).toBeNull();
    }
  );
});
