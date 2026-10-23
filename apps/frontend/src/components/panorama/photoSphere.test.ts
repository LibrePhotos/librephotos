import { describe, expect, it, vi } from "vitest";
import { isPhotoSphere, probeWebGL } from "./photoSphere";

describe("isPhotoSphere", () => {
  it("is true only for an equirectangular projection", () => {
    expect(isPhotoSphere({ projection_type: "equirectangular" })).toBe(true);
    expect(isPhotoSphere({ projection_type: "cylindrical" })).toBe(false);
    expect(isPhotoSphere({ projection_type: null })).toBe(false);
    expect(isPhotoSphere({})).toBe(false);
    expect(isPhotoSphere(undefined)).toBe(false);
  });
});

describe("probeWebGL", () => {
  it("is true for a WebGL 2 context, which it releases again", () => {
    const loseContext = vi.fn<() => void>();
    const open = vi.fn((_kind: "webgl2" | "webgl") => ({ getExtension: () => ({ loseContext }) }));

    expect(probeWebGL(open)).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith("webgl2");
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it("falls back to WebGL 1", () => {
    const open = vi.fn((kind: "webgl2" | "webgl") => (kind === "webgl" ? { getExtension: () => null } : null));

    expect(probeWebGL(open)).toBe(true);
    expect(open).toHaveBeenLastCalledWith("webgl");
  });

  it("is false without WebGL", () => {
    expect(probeWebGL(() => null)).toBe(false);
  });

  it("is false when asking throws", () => {
    expect(
      probeWebGL(() => {
        throw new Error("blocked");
      })
    ).toBe(false);
  });
});
