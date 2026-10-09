import { describe, expect, it } from "vitest";
import { uploadLocation } from "./uploadLocation";

describe("uploadLocation", () => {
  it("is the web subfolder of the uploads folder inside the scan directory by default", () => {
    expect(uploadLocation("/data/alice")).toBe("/data/alice/uploads/web");
    expect(uploadLocation("/data/alice/", "")).toBe("/data/alice/uploads/web");
    expect(uploadLocation("/data/alice", null)).toBe("/data/alice/uploads/web");
  });

  it("keeps Windows separators", () => {
    expect(uploadLocation("C:\\data\\alice")).toBe("C:\\data\\alice\\uploads\\web");
    expect(uploadLocation("C:\\data\\alice\\")).toBe("C:\\data\\alice\\uploads\\web");
    expect(uploadLocation("C:\\data\\alice", "C:\\data\\inbox\\")).toBe("C:\\data\\inbox\\web");
  });

  it("is the web subfolder of the configured upload folder when one is set", () => {
    expect(uploadLocation("/data/alice", "/data/alice/phone")).toBe("/data/alice/phone/web");
    expect(uploadLocation("/data/alice", "/data/alice/phone/")).toBe("/data/alice/phone/web");
  });

  it("is nothing without a scan directory, because uploads are refused then", () => {
    expect(uploadLocation("")).toBeNull();
    expect(uploadLocation(null)).toBeNull();
    expect(uploadLocation(undefined, "/data/inbox")).toBeNull();
  });
});
