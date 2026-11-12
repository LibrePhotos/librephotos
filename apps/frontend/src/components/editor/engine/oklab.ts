/**
 * The colour maths of the develop stage on the CPU, as the shaders have it (shaders/common.glsl,
 * shaders/oklab.glsl): the sRGB transfer functions and Björn Ottosson's OkLab with his published
 * matrices. The panels paint their colour wheels and band chips with it, so what they show is the
 * colour the pipeline makes.
 */

export type Rgb = readonly [r: number, g: number, b: number];

/** Linear light to the sRGB encoding (one channel). */
export function oetf(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}

/** The sRGB encoding to linear light (one channel). */
export function eotf(e: number): number {
  return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4;
}

/** Linear sRGB to OkLab `(L, a, b)`. */
export function linearToOklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OkLab `(L, a, b)` to linear sRGB (out of gamut values are left as they are). */
export function oklabToLinear([lightness, a, b]: Rgb): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * An OkLab colour given by lightness, chroma and hue (degrees, `atan2(b, a)` as the pipeline's
 * colour stage measures it) as 8-bit sRGB, clamped into the gamut the way the pipeline clamps.
 */
export function oklchToSrgb8(lightness: number, chroma: number, hue: number): Rgb {
  const radians = (hue * Math.PI) / 180;
  const linear = oklabToLinear([lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)]);
  const byte = (x: number) => Math.round(oetf(clamp01(x)) * 255);
  return [byte(linear[0]), byte(linear[1]), byte(linear[2])];
}
