/**
 * The edit recipe as the editor works with it: dense (every key present), with conversions from
 * and to the sparse recipe the server stores (only non-default values plus `version`). See
 * apps/docs/docs/development/photo-editing.md, "Edit recipe".
 */
import { EDIT_BANDS, EditRecipe, type EditBand } from "@librephotos/api-client";

/** `T` with every optional key present (arrays and `null` stay as they are). */
type Dense<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]-?: Dense<Exclude<T[K], undefined>> }
    : T;

/** A full recipe: every group and key present. */
export type Recipe = Dense<EditRecipe>;
export type GeometrySettings = Recipe["geometry"];
export type Orientation = GeometrySettings["orientation"];
export type CropRect = NonNullable<GeometrySettings["crop"]>;
export type CurvePoints = Recipe["curve"]["master"];
export type CurveChannel = keyof Recipe["curve"];
type MixerBandSettings = Recipe["mixer"]["red"];
type GradingWheelSettings = Recipe["grading"]["shadows"];
export type GradingWheel = "shadows" | "midtones" | "highlights" | "global";

const IDENTITY_CURVE: CurvePoints = [
  [0, 0],
  [1, 1],
];
const ZERO_BAND: MixerBandSettings = { hue: 0, sat: 0, lum: 0 };
const ZERO_WHEEL: GradingWheelSettings = { hue: 0, sat: 0, lum: 0 };

function eachBand<T>(value: T): Record<EditBand, T> {
  return {
    red: value,
    orange: value,
    yellow: value,
    green: value,
    aqua: value,
    blue: value,
    purple: value,
    magenta: value,
  };
}

/** The default recipe: it changes nothing. */
export const DEFAULT_RECIPE: Recipe = {
  version: 1,
  geometry: { orientation: 0, flip_h: false, flip_v: false, straighten: 0, crop: null, aspect: null },
  wb: { temp: 0, tint: 0 },
  light: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
  curve: { master: IDENTITY_CURVE, red: IDENTITY_CURVE, green: IDENTITY_CURVE, blue: IDENTITY_CURVE },
  color: { vibrance: 0, saturation: 0, treatment: "color" },
  mixer: eachBand(ZERO_BAND),
  bw_mix: eachBand(0),
  grading: {
    shadows: ZERO_WHEEL,
    midtones: ZERO_WHEEL,
    highlights: ZERO_WHEEL,
    global: ZERO_WHEEL,
    blending: 50,
    balance: 0,
  },
  effects: { texture: 0, clarity: 0, dehaze: 0 },
  vignette: { amount: 0, midpoint: 50, feather: 50, roundness: 0 },
  grain: { amount: 0, size: 25, roughness: 50, seed: 0 },
  detail: { sharpen_amount: 0, sharpen_radius: 1, nr_luminance: 0, nr_color: 0 },
};

function mergeBands<V extends object>(
  defaults: Record<EditBand, V>,
  sparse: Partial<Record<EditBand, Partial<V>>> | undefined
): Record<EditBand, V> {
  const merged = { ...defaults };
  for (const band of EDIT_BANDS) merged[band] = { ...defaults[band], ...sparse?.[band] };
  return merged;
}

/** The full recipe of a sparse one: every missing key takes its default. */
export function toDense(sparse: EditRecipe): Recipe {
  const d = DEFAULT_RECIPE;
  const grading = sparse.grading;
  return {
    version: 1,
    geometry: { ...d.geometry, ...sparse.geometry },
    wb: { ...d.wb, ...sparse.wb },
    light: { ...d.light, ...sparse.light },
    curve: { ...d.curve, ...sparse.curve },
    color: { ...d.color, ...sparse.color },
    mixer: mergeBands(d.mixer, sparse.mixer),
    bw_mix: { ...d.bw_mix, ...sparse.bw_mix },
    grading: {
      ...d.grading,
      ...grading,
      shadows: { ...d.grading.shadows, ...grading?.shadows },
      midtones: { ...d.grading.midtones, ...grading?.midtones },
      highlights: { ...d.grading.highlights, ...grading?.highlights },
      global: { ...d.grading.global, ...grading?.global },
    },
    effects: { ...d.effects, ...sparse.effects },
    vignette: { ...d.vignette, ...sparse.vignette },
    grain: { ...d.grain, ...sparse.grain },
    detail: { ...d.detail, ...sparse.detail },
  };
}

/** A plain object (not an array, not null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Two recipe values (numbers, strings, arrays of points, objects) are the same. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(key => sameValue(a[key], b[key]));
  }
  return false;
}

/** What of `value` differs from `fallback`: undefined when nothing does. */
function difference(value: unknown, fallback: unknown): unknown {
  if (sameValue(value, fallback)) return undefined;
  if (!isRecord(value) || !isRecord(fallback)) return value;
  const changed: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const diff = difference(item, fallback[key]);
    if (diff !== undefined) changed[key] = diff;
  }
  return Object.keys(changed).length > 0 ? changed : undefined;
}

/** The sparse recipe of a full one: only the values that differ from their default, plus `version`. */
export function toSparse(recipe: Recipe): EditRecipe {
  const changed = difference(recipe, DEFAULT_RECIPE);
  return EditRecipe.parse({ ...(isRecord(changed) ? changed : {}), version: 1 });
}

/**
 * Whether a recipe changes nothing: every value is its default, except the aspect ratio, which only
 * locks the crop tool.
 */
export function isIdentity(recipe: Recipe): boolean {
  return sameValue({ ...recipe, geometry: { ...recipe.geometry, aspect: null } }, DEFAULT_RECIPE);
}

/** Whether a recipe turns, mirrors, straightens or crops the picture. */
export function changesGeometry(recipe: Recipe): boolean {
  const { orientation, flip_h: flipH, flip_v: flipV, straighten, crop } = recipe.geometry;
  return orientation !== 0 || flipH || flipV || straighten !== 0 || crop !== null;
}

/** The "before" view: the recipe with only its geometry kept, so the framing matches. */
export function beforeRecipe(recipe: Recipe): Recipe {
  return { ...DEFAULT_RECIPE, geometry: recipe.geometry };
}
