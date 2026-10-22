import { describe, expect, it } from "vitest";
import { isBelow, isLeftOut, leftOutBelow, newlyLeftOut, toggleLeftOut } from "./excludedPaths";

describe("excludedPaths (#791)", () => {
  it("tells a folder below another on a path boundary, with either separator", () => {
    expect(isBelow("/data/a/trip", "/data/a")).toBe(true);
    expect(isBelow("C:/data\\a\\trip", "C:/data\\a")).toBe(true);
    expect(isBelow("/data/a", "/data/a")).toBe(false);
    expect(isBelow("/data/ab", "/data/a")).toBe(false);
    expect(isBelow("/data/a/trip", "/data/a/")).toBe(true);
  });

  it("finds what is left out, itself or below a left-out folder", () => {
    const excluded = ["/data/a/trip"];
    expect(isLeftOut(excluded, "/data/a/trip")).toBe(true);
    expect(isLeftOut(excluded, "/data/a/trip/day 1")).toBe(true);
    expect(isLeftOut(excluded, "/data/a/trips")).toBe(false);
    expect(leftOutBelow(["/data/a/trip", "/data/b/x"], "/data/a")).toEqual(["/data/a/trip"]);
  });

  it("unticks a folder over the ones below it, and ticks it back in", () => {
    const below = ["/data/a/trip/day 1", "/data/b"];
    const out = toggleLeftOut(below, "/data/a/trip");
    expect(out).toEqual(["/data/a/trip", "/data/b"]);
    expect(toggleLeftOut(out, "/data/a/trip")).toEqual(["/data/b"]);
  });

  it("names the folders newly left out", () => {
    expect(newlyLeftOut(["/data/a/trip"], ["/data/a/trip", "/data/a/x", "/data/a/trip/y"])).toEqual(["/data/a/x"]);
  });
});
