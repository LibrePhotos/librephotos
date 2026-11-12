/**
 * The colour grading wheel without React: a wheel's hue and amount as a point of the unit disc
 * (angle = hue as OkLab measures it, counter-clockwise from the right; radius = sat / 100), back,
 * the arrow keys' steps, and the disc's pixels painted with the engine's OkLab maths.
 */
import { oklchToSrgb8 } from "../engine/oklab";

export type WheelValue = Readonly<{ hue: number; sat: number }>;
/** A point of the unit disc, y up. */
export type DiscPoint = Readonly<{ x: number; y: number }>;

/** The disc's lightness and its chroma at the rim: a mid grey centre turning into clear colours. */
const DISC_LIGHTNESS = 0.72;
const RIM_CHROMA = 0.14;

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const wrapHue = (hue: number) => ((Math.round(hue) % 360) + 360) % 360;

/** Where a wheel's handle sits. */
export function wheelPoint({ hue, sat }: WheelValue): DiscPoint {
  const radians = (hue * Math.PI) / 180;
  const r = clamp(sat, 0, 100) / 100;
  return { x: r * Math.cos(radians), y: r * Math.sin(radians) };
}

/** The hue (whole degrees, 0 to 359) and amount (0 to 100) of a point; outside the disc counts as its rim. */
export function wheelValue({ x, y }: DiscPoint): WheelValue {
  const hue = wrapHue((Math.atan2(y, x) * 180) / Math.PI);
  return { hue, sat: Math.round(clamp(Math.hypot(x, y), 0, 1) * 100) };
}

/** The arrow keys: left and right turn the hue, up and down change the amount (Shift: ten times as far). */
export function nudgeWheel(value: WheelValue, key: string, large: boolean): WheelValue | null {
  const step = large ? 10 : 1;
  switch (key) {
    case "ArrowLeft":
      return { ...value, hue: wrapHue(value.hue + step) };
    case "ArrowRight":
      return { ...value, hue: wrapHue(value.hue - step) };
    case "ArrowUp":
      return { ...value, sat: clamp(value.sat + step, 0, 100) };
    case "ArrowDown":
      return { ...value, sat: clamp(value.sat - step, 0, 100) };
    default:
      return null;
  }
}

/**
 * The RGBA pixels of a `size` x `size` disc: each pixel the OkLab colour of its hue at a chroma
 * growing with its distance from the centre, transparent outside, with a one-pixel soft rim.
 */
export function paintWheel(size: number): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const radius = size / 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5 - radius) / radius;
      const y = (radius - (j + 0.5)) / radius;
      const distance = Math.hypot(x, y);
      const alpha = clamp((1 - distance) * radius + 0.5, 0, 1);
      if (alpha === 0) continue;
      const hue = (Math.atan2(y, x) * 180) / Math.PI;
      const [r, g, b] = oklchToSrgb8(DISC_LIGHTNESS, RIM_CHROMA * Math.min(distance, 1), hue);
      const at = (j * size + i) * 4;
      pixels[at] = r;
      pixels[at + 1] = g;
      pixels[at + 2] = b;
      pixels[at + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}
