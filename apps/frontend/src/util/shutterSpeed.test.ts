import { describe, expect, it } from "vitest";
import { formatShutterSpeed } from "./shutterSpeed";

describe("formatShutterSpeed", () => {
  it("keeps a fraction of a second as cameras print it", () => {
    expect(formatShutterSpeed("1/4000")).toBe("1/4000");
    expect(formatShutterSpeed("1/250")).toBe("1/250");
  });

  it("gives seconds a unit", () => {
    expect(formatShutterSpeed("2.5")).toBe("2.5 s");
    expect(formatShutterSpeed("0.3")).toBe("0.3 s");
    expect(formatShutterSpeed("30")).toBe("30 s");
  });

  it("leaves out a missing value and an older backend's 0", () => {
    expect(formatShutterSpeed(null)).toBeNull();
    expect(formatShutterSpeed(undefined)).toBeNull();
    expect(formatShutterSpeed("")).toBeNull();
    expect(formatShutterSpeed("0")).toBeNull();
  });

  it("passes an older backend's improper fraction through", () => {
    expect(formatShutterSpeed("5/2")).toBe("5/2");
  });
});
