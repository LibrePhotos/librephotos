import { describe, expect, it } from "vitest";
import { uploadLocation } from "./uploadLocation";

describe("uploadLocation", () => {
  it("is the uploads folder inside the scan directory by default", () => {
    expect(uploadLocation("/data/alice")).toBe("/data/alice/uploads");
    expect(uploadLocation("/data/alice/", "")).toBe("/data/alice/uploads");
    expect(uploadLocation("/data/alice", null)).toBe("/data/alice/uploads");
  });

  it("keeps Windows separators", () => {
    expect(uploadLocation("C:\\data\\alice")).toBe("C:\\data\\alice\\uploads");
    expect(uploadLocation("C:\\data\\alice\\")).toBe("C:\\data\\alice\\uploads");
  });

  it("is the configured upload folder when one is set", () => {
    expect(uploadLocation("/data/alice", "/data/alice/phone")).toBe("/data/alice/phone");
  });
});
