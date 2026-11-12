/**
 * What each pass of the renderer needs from a recipe, as plain values: which stages run (the doc
 * skips some at their defaults), the sizes of the working picture and the planes, and the uniforms
 * of the develop and finish passes.
 */
import { capSize, outputSize, type Size } from "./geometry";
import { DEFAULT_RECIPE, sameValue, type GradingWheel, type Recipe } from "./recipe";
import { whiteBalance } from "./tables";

/** The relative pixel `u = L / 2560` of a picture whose long edge is `L`. */
const REFERENCE_EDGE = 2560;

/**
 * The picture the passes work on: the output size of the source the renderer has (its pixels are
 * the source's, so a zoom stays sharp up to them), capped at `maxEdge`.
 */
export function workingSize(recipe: Recipe, source: Size, maxEdge: number, fullFrame: boolean): Size {
  return capSize(outputSize(recipe.geometry, source, fullFrame), maxEdge);
}

/** Stage 2 runs unless both noise reduction amounts are 0. */
export function needsNoiseReduction(recipe: Recipe): boolean {
  return recipe.detail.nr_luminance > 0 || recipe.detail.nr_color > 0;
}

/**
 * Stage 3's planes are only read by Dehaze, Highlights, Shadows, Clarity and Texture: at 0 each of
 * them leaves the pixel as it is, so the planes are skipped.
 */
export function needsPlanes(recipe: Recipe): boolean {
  const { highlights, shadows } = recipe.light;
  const { texture, clarity, dehaze } = recipe.effects;
  return highlights !== 0 || shadows !== 0 || texture !== 0 || clarity !== 0 || dehaze !== 0;
}

/** Stage 4.7 is skipped when every colour control is at its default and the treatment is colour. */
export function needsColor(recipe: Recipe): boolean {
  const { color, mixer, bw_mix: bwMix, grading } = recipe;
  return !(
    color.vibrance === 0 &&
    color.saturation === 0 &&
    color.treatment === "color" &&
    sameValue(mixer, DEFAULT_RECIPE.mixer) &&
    sameValue(bwMix, DEFAULT_RECIPE.bw_mix) &&
    sameValue(grading, DEFAULT_RECIPE.grading)
  );
}

/** A plane's size: long edge `min(maxEdge, L)`, short edge `max(1, round(Lp * short / long))`. */
export function planeSize(picture: Size, maxEdge: number): Size {
  const long = Math.max(picture.width, picture.height);
  const short = Math.min(picture.width, picture.height);
  const lp = Math.min(maxEdge, long);
  const sp = Math.max(1, Math.round((lp * short) / long));
  return picture.width >= picture.height ? { width: lp, height: sp } : { width: sp, height: lp };
}

/** The develop pass's uniforms (stage 4). */
export type DevelopUniforms = Readonly<{
  k: Float32Array;
  gain: number;
  M: number;
  dehaze: number;
  shadows: number;
  highlights: number;
  clarity: number;
  texture: number;
  useLight: boolean;
  useCurve: boolean;
  useColor: boolean;
  bw: boolean;
  vibrance: number;
  saturation: number;
  /** The four wheels' vectors `(sat / 100) (cos hue, sin hue)`: shadows, midtones, highlights, global. */
  gradeVectors: Float32Array;
  /** The four wheels' `lum / 100`, in the same order. */
  gradeLum: Float32Array;
  balance: number;
  blending: number;
}>;

const WHEELS: readonly GradingWheel[] = ["shadows", "midtones", "highlights", "global"];

export function developUniforms(recipe: Recipe, sourceMax: number): DevelopUniforms {
  const { k, gain, M } = whiteBalance(recipe.wb, recipe.light.exposure, sourceMax);
  const { light, curve, effects, grading } = recipe;
  return {
    k,
    gain,
    M,
    dehaze: effects.dehaze / 100,
    shadows: light.shadows / 100,
    highlights: light.highlights / 100,
    clarity: effects.clarity / 100,
    texture: effects.texture / 100,
    useLight: light.whites !== 0 || light.blacks !== 0 || light.contrast !== 0,
    useCurve: !sameValue(curve, DEFAULT_RECIPE.curve),
    useColor: needsColor(recipe),
    bw: recipe.color.treatment === "bw",
    vibrance: recipe.color.vibrance / 100,
    saturation: recipe.color.saturation / 100,
    gradeVectors: new Float32Array(
      WHEELS.flatMap(wheel => {
        const { hue, sat } = grading[wheel];
        const radians = (hue * Math.PI) / 180;
        return [(sat / 100) * Math.cos(radians), (sat / 100) * Math.sin(radians)];
      })
    ),
    gradeLum: new Float32Array(WHEELS.map(wheel => grading[wheel].lum / 100)),
    balance: grading.balance / 100,
    blending: grading.blending / 100,
  };
}

/** The finish pass's uniforms (stage 5); amounts of 0 skip their part. */
export type FinishUniforms = Readonly<{
  sharpen: number;
  /** The sharpening sigma in picture pixels: `0.8 sharpen_radius u`. */
  sigma: number;
  vignette: number;
  midpoint: number;
  feather: number;
  roundness: number;
  grain: number;
  /** Grain cells along the long edge: `2560 / (1 + 3 size / 100)`. */
  cells: number;
  roughness: number;
  seed: number;
}>;

export function finishUniforms(recipe: Recipe, picture: Size): FinishUniforms {
  const u = Math.max(picture.width, picture.height) / REFERENCE_EDGE;
  const { detail, vignette, grain } = recipe;
  return {
    sharpen: detail.sharpen_amount / 100,
    sigma: 0.8 * detail.sharpen_radius * u,
    vignette: vignette.amount / 100,
    midpoint: vignette.midpoint / 100,
    feather: vignette.feather / 100,
    roundness: vignette.roundness / 100,
    grain: grain.amount / 100,
    cells: REFERENCE_EDGE / (1 + (3 * grain.size) / 100),
    roughness: grain.roughness / 100,
    seed: grain.seed,
  };
}

/** Whether stage 5 changes anything: sharpening, vignette or grain. */
export function needsFinish(recipe: Recipe): boolean {
  return recipe.detail.sharpen_amount > 0 || recipe.vignette.amount !== 0 || recipe.grain.amount > 0;
}
