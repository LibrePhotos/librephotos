import { describe, expect, it } from "vitest";
import { parentPath } from "./MobileBackButton";

describe("parentPath", () => {
  it("goes one level up, and to the timeline from a top-level page", () => {
    expect(parentPath("/album/user/3")).toBe("/album/user");
    expect(parentPath("/album/persons")).toBe("/album");
    expect(parentPath("/settings")).toBe("/");
  });
});
