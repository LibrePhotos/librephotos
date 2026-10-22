import { describe, expect, it } from "vitest";
import { heightForKey } from "./MapResizeHandle";

describe("heightForKey", () => {
  it("steps with the arrows and pages, within the limits", () => {
    expect(heightForKey("ArrowDown", 240, 240, 560)).toBe(260);
    expect(heightForKey("ArrowUp", 240, 240, 560)).toBe(240);
    expect(heightForKey("PageDown", 500, 240, 560)).toBe(560);
    expect(heightForKey("PageUp", 400, 240, 560)).toBe(300);
  });

  it("jumps to the ends with Home and End, and ignores other keys", () => {
    expect(heightForKey("Home", 400, 240, 560)).toBe(240);
    expect(heightForKey("End", 400, 240, 560)).toBe(560);
    expect(heightForKey("a", 400, 240, 560)).toBeNull();
  });
});
