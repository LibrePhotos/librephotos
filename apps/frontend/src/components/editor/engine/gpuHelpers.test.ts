/** The pure parts around the GPU: shader assembly, the histogram, source scaling and the probe. */
import { describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { probeEditing } from "./canEdit";
import { rgbToRgba } from "./glResources";
import { histogramOf } from "./histogram";
import { assembleShader, FRAGMENT_SHADERS, VERTEX_SHADER } from "./shaders";
import { downscalePixels } from "./sourceTexture";

describe("shaders", () => {
  it("start with the GLSL ES 3.00 version line and have no include left", () => {
    for (const source of [VERTEX_SHADER, ...Object.values(FRAGMENT_SHADERS)]) {
      expect(source.startsWith("#version 300 es\n")).toBe(true);
      expect(source).not.toMatch(/#include/);
    }
    expect(FRAGMENT_SHADERS.develop).toContain("vec3 linearToOklab");
    expect(FRAGMENT_SHADERS.finish).toContain("0x8da6b343u");
  });

  it("replaces an include line by its chunk and refuses an unknown one", () => {
    expect(assembleShader("a\n//#include x\nb", { x: "X" })).toBe("a\nX\nb");
    expect(() => assembleShader("//#include y", {})).toThrow(/y/);
  });
});

describe("histogram", () => {
  it("counts each channel and the luminance, leaving transparent pixels out", () => {
    const pixels = new Uint8Array([255, 0, 0, 255, 10, 20, 30, 255, 9, 9, 9, 0]);
    const histogram = histogramOf(pixels);
    expect(histogram.r[255]).toBe(1);
    expect(histogram.r[10]).toBe(1);
    expect(histogram.r[9]).toBe(0);
    expect(histogram.g[0]).toBe(1);
    expect(histogram.luma[Math.round(0.2126 * 255)]).toBe(1);
    expect(histogram.luma[Math.round(0.2126 * 10 + 0.7152 * 20 + 0.0722 * 30)]).toBe(1);
    expect([...histogram.b].reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe("source scaling", () => {
  it("averages linear pixels down", () => {
    const pixels = new Float32Array([0, 0, 0, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const out = downscalePixels(pixels, { width: 4, height: 1 }, { width: 2, height: 1 });
    expect([...out]).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  });

  it("packs RGB as RGBA", () => {
    expect([...rgbToRgba(new Float32Array([1, 2, 3, 4, 5, 6]))]).toEqual([1, 2, 3, 1, 4, 5, 6, 1]);
  });
});

describe("probeEditing", () => {
  it("needs WebGL2 with float render targets, and drops the context again", () => {
    const loseContext = vi.fn<() => void>();
    const withFloats = (name: string): unknown =>
      name === "WEBGL_lose_context" ? { loseContext } : name === "EXT_color_buffer_float" ? {} : null;
    expect(probeEditing(() => ({ getExtension: withFloats }))).toBe(true);
    expect(loseContext).toHaveBeenCalledOnce();
    expect(probeEditing(() => ({ getExtension: () => null }))).toBe(false);
    expect(probeEditing(() => null)).toBe(false);
    expect(
      probeEditing(() => {
        throw new Error("blocked");
      })
    ).toBe(false);
    expect(defined(withFloats("EXT_color_buffer_float"))).toEqual({});
  });
});
