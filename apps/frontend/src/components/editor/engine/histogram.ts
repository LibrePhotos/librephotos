/** The histogram of the finished picture: 256 bins each for red, green, blue and luminance. */
import { LUMA } from "./tables";

export type Histogram = Readonly<{ r: Uint32Array; g: Uint32Array; b: Uint32Array; luma: Uint32Array }>;

/**
 * The histogram of RGBA bytes (display-encoded). Pixels with alpha 0 (outside the picture) are left
 * out; luminance is `Y` of the encoded values, rounded to a bin.
 */
export function histogramOf(pixels: Uint8Array | Uint8ClampedArray): Histogram {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const luma = new Uint32Array(256);
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const red = pixels[i] ?? 0;
    const green = pixels[i + 1] ?? 0;
    const blue = pixels[i + 2] ?? 0;
    r[red] = (r[red] ?? 0) + 1;
    g[green] = (g[green] ?? 0) + 1;
    b[blue] = (b[blue] ?? 0) + 1;
    const y = Math.min(255, Math.round(LUMA[0] * red + LUMA[1] * green + LUMA[2] * blue));
    luma[y] = (luma[y] ?? 0) + 1;
  }
  return { r, g, b, luma };
}
