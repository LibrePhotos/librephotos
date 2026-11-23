/**
 * The built-in looks of the editor's Filters tab (and of the advanced mode's presets panel): each a
 * set of number controls over the tone, colour and effects groups, never the geometry, so a look
 * keeps the crop. Applying one is a single `preset` history step whose value is the look's id; its
 * strength blends every control it sets from the photo's value before the look to the look's own.
 */
import type { EditHistoryStep } from "@librephotos/api-client";
import { NUMBER_CONTROLS, readNumber, withControl, type NumberControlPath } from "../engine/controls";
import { DEFAULT_RECIPE, toDense, type Recipe } from "../engine/recipe";

/** The looks, in the order the Filters tab lists them. */
export const FILTER_IDS = [
  "vivid",
  "warm",
  "cool",
  "fade",
  "matte",
  "punch",
  "golden",
  "cinematic",
  "mono",
  "monoContrast",
  "sepia",
  "film",
] as const;
export type FilterId = (typeof FILTER_IDS)[number];

/** The id of the step that removes a look: the photo as it was before it. */
export const ORIGINAL_FILTER = "original";

/** What a look sets: number controls only (geometry excluded), so every one of them blends. */
export type FilterValues = Readonly<Partial<Record<Exclude<NumberControlPath, `geometry.${string}`>, number>>>;

export type EditFilter = Readonly<{ id: FilterId; values: FilterValues }>;

/** Every look's controls. Mono looks drop the colour with Saturation, so they blend too. */
const FILTER_VALUES: Readonly<Record<FilterId, FilterValues>> = {
  vivid: { "color.vibrance": 35, "color.saturation": 10, "light.contrast": 15 },
  warm: { "wb.temp": 25, "wb.tint": 5, "color.vibrance": 10 },
  cool: { "wb.temp": -25, "wb.tint": -3, "color.vibrance": 5 },
  fade: { "light.contrast": -25, "light.blacks": 40, "color.saturation": -15 },
  matte: { "light.contrast": -15, "light.blacks": 30, "light.whites": -15, "color.saturation": -10 },
  punch: { "light.contrast": 35, "effects.clarity": 25, "color.vibrance": 20, "light.shadows": 10 },
  golden: {
    "wb.temp": 30,
    "wb.tint": 8,
    "light.exposure": 0.1,
    "grading.highlights.hue": 45,
    "grading.highlights.sat": 30,
  },
  cinematic: {
    "light.contrast": 15,
    "color.saturation": -10,
    "grading.shadows.hue": 195,
    "grading.shadows.sat": 75,
    "grading.highlights.hue": 35,
    "grading.highlights.sat": 60,
  },
  mono: { "color.saturation": -100 },
  monoContrast: { "color.saturation": -100, "light.contrast": 40, "effects.clarity": 20, "light.blacks": -15 },
  sepia: {
    "color.saturation": -100,
    "grading.global.hue": 40,
    "grading.global.sat": 45,
    "grading.highlights.hue": 50,
    "grading.highlights.sat": 20,
  },
  film: {
    "grain.amount": 35,
    "grain.size": 30,
    "light.contrast": -10,
    "light.blacks": 15,
    "color.saturation": -10,
    "wb.temp": 8,
    "vignette.amount": -20,
  },
};

export const EDIT_FILTERS: readonly EditFilter[] = FILTER_IDS.map(id => ({ id, values: FILTER_VALUES[id] }));

function isFilterId(value: unknown): value is FilterId {
  return FILTER_IDS.some(id => id === value);
}

/** A look's controls with their values, in the control table's order. */
function entries(values: FilterValues): [NumberControlPath, number][] {
  const listed: [NumberControlPath, number][] = [];
  for (const [key, value] of Object.entries(values)) {
    const path = NUMBER_CONTROLS.find(control => control === key);
    if (path !== undefined && value !== undefined) listed.push([path, value]);
  }
  return listed;
}

/** The recipe with a look applied at `strength` (0 to 1) over `base`, the photo before the look. */
export function blendFilter(base: Recipe, values: FilterValues, strength: number): Recipe {
  const s = Math.min(1, Math.max(0, strength));
  let recipe = base;
  for (const [path, target] of entries(values)) {
    const from = readNumber(base, path);
    recipe = withControl(recipe, path, takesTarget(base, path) ? target : from + (target - from) * s);
  }
  return recipe;
}

const WHEELS = ["shadows", "midtones", "highlights", "global"] as const;

/**
 * Whether a control takes the look's value at any strength: a grading wheel's hue where the photo
 * had no colour on that wheel. Only the wheel's amount blends; a hue blended from 0 would pass
 * through every colour on its way.
 */
function takesTarget(base: Recipe, path: NumberControlPath): boolean {
  const wheel = WHEELS.find(name => path === `grading.${name}.hue`);
  return wheel !== undefined && readNumber(base, `grading.${wheel}.sat`) === 0;
}

/**
 * How strongly a look shows in `current`, 0 to 1: read from the control it moves most (1 when it
 * moves nothing from `base`). The strength is not stored; it is what the recipe says.
 */
export function filterStrength(base: Recipe, values: FilterValues, current: Recipe): number {
  let widest: [from: number, to: number, path: NumberControlPath] | null = null;
  for (const [path, target] of entries(values)) {
    if (takesTarget(base, path)) continue;
    const from = readNumber(base, path);
    if (widest === null || Math.abs(target - from) > Math.abs(widest[1] - widest[0])) widest = [from, target, path];
  }
  if (widest === null || widest[1] === widest[0]) return 1;
  const [from, to, path] = widest;
  return Math.min(1, Math.max(0, (readNumber(current, path) - from) / (to - from)));
}

/** The look under the history's cursor and the recipe it was applied over. */
export type AppliedFilter = Readonly<{ id: FilterId | null; base: Recipe }>;

/**
 * Which look the step under the cursor applied (null for none, or for Original), and the recipe
 * before the run of look steps that ends there: a new look or a strength replaces the last one
 * instead of piling onto it.
 */
export function appliedFilter(history: readonly EditHistoryStep[], cursor: number, current: Recipe): AppliedFilter {
  const step = history[cursor];
  if (step?.action !== "preset") return { id: null, base: current };
  let first = cursor;
  while (history[first - 1]?.action === "preset") first -= 1;
  const before = history[first - 1];
  const base = before ? toDense(before.settings) : DEFAULT_RECIPE;
  return { id: isFilterId(step.value) ? step.value : null, base };
}
