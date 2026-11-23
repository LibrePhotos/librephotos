/**
 * The recipe's controls by their dotted path (`"light.exposure"`): the UI builds sliders from
 * their ranges and defaults, and history steps name the control they changed by its path.
 */
import { EDIT_BANDS, EditRecipe, type EditAspect, type EditBand } from "@librephotos/api-client";
import {
  isRecord,
  toDense,
  type CropRect,
  type CurveChannel,
  type CurvePoints,
  type GradingWheel,
  type Orientation,
  type Recipe,
} from "./recipe";

type MixerChannel = "hue" | "sat" | "lum";

/** A control whose value is a number: every slider. */
export type NumberControlPath =
  | "geometry.straighten"
  | `wb.${"temp" | "tint"}`
  | `light.${"exposure" | "contrast" | "highlights" | "shadows" | "whites" | "blacks"}`
  | `color.${"vibrance" | "saturation"}`
  | `mixer.${EditBand}.${MixerChannel}`
  | `bw_mix.${EditBand}`
  | `grading.${GradingWheel}.${MixerChannel}`
  | `grading.${"blending" | "balance"}`
  | `effects.${"texture" | "clarity" | "dehaze"}`
  | `vignette.${"amount" | "midpoint" | "feather" | "roundness"}`
  | `grain.${"amount" | "size" | "roughness" | "seed"}`
  | `detail.${"sharpen_amount" | "sharpen_radius" | "nr_luminance" | "nr_color"}`;
type BooleanControlPath = "geometry.flip_h" | "geometry.flip_v";
type ChoiceControlPath = "geometry.orientation" | "geometry.aspect" | "color.treatment";
type CurveControlPath = `curve.${CurveChannel}`;
/** Every control a history step can name. */
export type ControlPath =
  NumberControlPath | BooleanControlPath | ChoiceControlPath | CurveControlPath | "geometry.crop";

/** The value a control takes. */
export type ControlValue<P extends ControlPath> = P extends NumberControlPath
  ? number
  : P extends BooleanControlPath
    ? boolean
    : P extends "geometry.orientation"
      ? Orientation
      : P extends "geometry.aspect"
        ? EditAspect | null
        : P extends "color.treatment"
          ? Recipe["color"]["treatment"]
          : P extends CurveControlPath
            ? CurvePoints
            : P extends "geometry.crop"
              ? CropRect | null
              : never;

/** A number control's range and default; `integer` controls take whole numbers only. */
export type NumberControlSpec = Readonly<{
  path: NumberControlPath;
  min: number;
  max: number;
  default: number;
  integer: boolean;
}>;

type Range = readonly [min: number, max: number, fallback: number];
const SIGNED: Range = [-100, 100, 0];
const PERCENT: Range = [0, 100, 0];

/** The controls whose range is not the mixer's, the B&W mix's or a grading wheel's. */
const RANGES: Readonly<Record<string, Range>> = {
  "geometry.straighten": [-45, 45, 0],
  "wb.temp": SIGNED,
  "wb.tint": SIGNED,
  "light.exposure": [-5, 5, 0],
  "light.contrast": SIGNED,
  "light.highlights": SIGNED,
  "light.shadows": SIGNED,
  "light.whites": SIGNED,
  "light.blacks": SIGNED,
  "color.vibrance": SIGNED,
  "color.saturation": SIGNED,
  "grading.blending": [0, 100, 50],
  "grading.balance": SIGNED,
  "effects.texture": SIGNED,
  "effects.clarity": SIGNED,
  "effects.dehaze": SIGNED,
  "vignette.amount": SIGNED,
  "vignette.midpoint": [0, 100, 50],
  "vignette.feather": [0, 100, 50],
  "vignette.roundness": SIGNED,
  "grain.amount": PERCENT,
  "grain.size": [0, 100, 25],
  "grain.roughness": [0, 100, 50],
  "grain.seed": [0, 4294967295, 0],
  "detail.sharpen_amount": [0, 150, 0],
  "detail.sharpen_radius": [0.5, 3, 1],
  "detail.nr_luminance": PERCENT,
  "detail.nr_color": PERCENT,
};

const GRADING_RANGES: Readonly<Record<MixerChannel, Range>> = { hue: [0, 360, 0], sat: PERCENT, lum: SIGNED };
const WHEELS: readonly GradingWheel[] = ["shadows", "midtones", "highlights", "global"];
const CHANNELS: readonly MixerChannel[] = ["hue", "sat", "lum"];

function rangeOf(path: NumberControlPath): Range {
  const [group, , channel] = path.split(".");
  if (group === "mixer" || group === "bw_mix") return SIGNED;
  if (group === "grading" && channel !== undefined) {
    const range = GRADING_RANGES[channel === "hue" || channel === "sat" ? channel : "lum"];
    return range;
  }
  const range = RANGES[path];
  if (range === undefined) throw new RangeError(`No range for ${path}`);
  return range;
}

/** A number control's range and default. */
export function numberControl(path: NumberControlPath): NumberControlSpec {
  const [min, max, fallback] = rangeOf(path);
  return { path, min, max, default: fallback, integer: path === "grain.seed" };
}

/** Every number control, group by group in the order of the recipe table. */
export const NUMBER_CONTROLS: readonly NumberControlPath[] = [
  "geometry.straighten",
  "wb.temp",
  "wb.tint",
  "light.exposure",
  "light.contrast",
  "light.highlights",
  "light.shadows",
  "light.whites",
  "light.blacks",
  "color.vibrance",
  "color.saturation",
  ...EDIT_BANDS.flatMap(band => CHANNELS.map(channel => `mixer.${band}.${channel}` as const)),
  ...EDIT_BANDS.map(band => `bw_mix.${band}` as const),
  ...WHEELS.flatMap(wheel => CHANNELS.map(channel => `grading.${wheel}.${channel}` as const)),
  "grading.blending",
  "grading.balance",
  "effects.texture",
  "effects.clarity",
  "effects.dehaze",
  "vignette.amount",
  "vignette.midpoint",
  "vignette.feather",
  "vignette.roundness",
  "grain.amount",
  "grain.size",
  "grain.roughness",
  "grain.seed",
  "detail.sharpen_amount",
  "detail.sharpen_radius",
  "detail.nr_luminance",
  "detail.nr_color",
];

/** The value at a dotted path of the recipe (a number, string, boolean, curve, crop or null). */
export function readControl(recipe: Recipe, path: ControlPath): unknown {
  let node: unknown = recipe;
  for (const key of path.split(".")) node = isRecord(node) ? node[key] : undefined;
  return node;
}

/** A number control's value. */
export function readNumber(recipe: Recipe, path: NumberControlPath): number {
  const value = readControl(recipe, path);
  if (typeof value !== "number") throw new TypeError(`${path} is not a number`);
  return value;
}

function withValue(node: unknown, keys: readonly string[], value: unknown): unknown {
  const [key, ...rest] = keys;
  if (key === undefined) return value;
  if (!isRecord(node)) throw new TypeError(`No group at ${key}`);
  return { ...node, [key]: withValue(node[key], rest, value) };
}

export function isNumberControl(path: ControlPath): path is NumberControlPath {
  return NUMBER_CONTROLS.some(control => control === path);
}

/** Every control a history step can name. */
export const CONTROL_PATHS: readonly ControlPath[] = [
  ...NUMBER_CONTROLS,
  "geometry.orientation",
  "geometry.flip_h",
  "geometry.flip_v",
  "geometry.crop",
  "geometry.aspect",
  "color.treatment",
  "curve.master",
  "curve.red",
  "curve.green",
  "curve.blue",
];

/** Whether a string (a history step's `control` from the server) names a control. */
export function isControlPath(value: unknown): value is ControlPath {
  return CONTROL_PATHS.some(path => path === value);
}

/** A number brought into a control's range (whole for an integer control). */
export function clampControl(path: NumberControlPath, value: number): number {
  const { min, max, integer } = numberControl(path);
  const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
  return integer ? Math.round(clamped) : clamped;
}

/**
 * The recipe with one control set. A number is brought into the control's range; any other value
 * the recipe cannot hold (a curve whose x does not increase) throws a RangeError.
 */
export function withControl<P extends ControlPath>(recipe: Recipe, path: P, value: ControlValue<P>): Recipe {
  const written = isNumberControl(path) && typeof value === "number" ? clampControl(path, value) : value;
  const parsed = EditRecipe.safeParse(withValue(recipe, path.split("."), written));
  if (!parsed.success) throw new RangeError(`${path} cannot be ${JSON.stringify(value)}`);
  return toDense(parsed.data);
}
