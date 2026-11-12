/**
 * How an edit slider steps and shows its value, from the control table (engine/controls.ts):
 * Exposure in hundredths of a stop, Straighten and the sharpening radius in tenths, everything
 * else in whole numbers. A bipolar control (its range spans zero) shows its sign and fills from
 * zero, not from its minimum.
 */
import { numberControl, type NumberControlPath } from "../engine/controls";

export type SliderSpec = Readonly<{
  min: number;
  max: number;
  /** The control's default: the mark on the track, and what a double click resets to. */
  origin: number;
  step: number;
  decimals: number;
  /** The range runs from below zero to above it: values show their sign, the fill starts at zero. */
  bipolar: boolean;
}>;

/** A narrower range than the control's own (the simple mode's Brightness), inside it. */
export type SliderRange = Readonly<{ min: number; max: number }>;

const DECIMALS: Partial<Record<NumberControlPath, number>> = {
  "light.exposure": 2,
  "geometry.straighten": 1,
  "detail.sharpen_radius": 1,
};

export function sliderSpec(path: NumberControlPath, range?: SliderRange): SliderSpec {
  const control = numberControl(path);
  const decimals = control.integer ? 0 : (DECIMALS[path] ?? 0);
  const min = Math.max(control.min, range?.min ?? control.min);
  const max = Math.min(control.max, range?.max ?? control.max);
  return {
    min,
    max,
    origin: Math.min(max, Math.max(min, control.default)),
    step: 10 ** -decimals,
    decimals,
    bipolar: min < 0 && max > 0,
  };
}

/** A value on the slider's grid (its step) and inside its range. */
export function snapValue(spec: SliderSpec, value: number): number {
  const clamped = Math.min(spec.max, Math.max(spec.min, Number.isFinite(value) ? value : spec.origin));
  const snapped = Math.round(clamped / spec.step) * spec.step;
  // Rounding to the decimals drops the float noise of the multiplication (0.1 * 3).
  const exact = Number(snapped.toFixed(spec.decimals));
  return Object.is(exact, -0) ? 0 : exact;
}

/** The value as the slider shows it: its decimals, and a `+` for a positive bipolar value. */
export function formatValue(spec: SliderSpec, value: number): string {
  const text = snapValue(spec, value).toFixed(spec.decimals);
  return spec.bipolar && value > 0 && Number(text) !== 0 ? `+${text}` : text;
}

/** A typed value (a comma or a point as the decimal mark, a leading `+`), or null when it is no number. */
export function parseValue(spec: SliderSpec, text: string): number | null {
  const cleaned = text.trim().replace(",", ".").replace(/^\+/, "");
  if (cleaned === "" || !/^-?\d*\.?\d*$/.test(cleaned) || cleaned === "-" || cleaned === ".") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? snapValue(spec, value) : null;
}
