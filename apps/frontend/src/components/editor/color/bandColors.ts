/**
 * The colour of each mixer band as its chip shows it: the band's hue from the pipeline (stage 4.7)
 * at a mid lightness and a moderate chroma in OkLab, through the engine's own colour maths.
 */
import { EDIT_BANDS, type EditBand } from "@librephotos/api-client";
import { oklchToSrgb8, type Rgb } from "../engine/oklab";
import { BAND_HUES } from "../engine/tables";

const CHIP_LIGHTNESS = 0.7;
const CHIP_CHROMA = 0.15;

/** A band's hue in degrees (OkLab `atan2(b, a)`). */
export function bandHue(band: EditBand): number {
  return BAND_HUES[EDIT_BANDS.indexOf(band)] ?? 0;
}

/** A band's chip colour, 8-bit sRGB. */
export function bandColor(band: EditBand): Rgb {
  return oklchToSrgb8(CHIP_LIGHTNESS, CHIP_CHROMA, bandHue(band));
}

/** RGBA pixels of a `width` x `height` swatch of one colour, for a canvas's ImageData. */
export function swatchPixels(color: Rgb, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = 255;
  }
  return pixels;
}
