/**
 * Auto: the six light controls proposed from the luminance histogram of the photo before its edits
 * (geometry only). Percentile based and damped: it spreads the tonal range to a well-exposed middle
 * without clipping, and an already balanced histogram yields values at or near zero, so it never
 * overcooks a good photo. Deterministic, bounded, and without React.
 */
import { withControl, type NumberControlPath } from "../engine/controls";
import { eotf, oetf } from "../engine/oklab";
import type { Recipe } from "../engine/recipe";

export type AutoTone = Readonly<{
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
}>;

const ZERO: AutoTone = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };

/**
 * The band of display values the median of a well-exposed photo lies in: a median inside it is
 * left alone (a high-key portrait or a moody street scene keeps its key), one outside is brought
 * to its nearer edge.
 */
const MEDIAN_BAND = [0.36, 0.6] as const;
/** Part of the exposure error that is corrected: a dark scene may stay a little dark. */
const EXPOSURE_DAMPING = 0.7;
/** An exposure change smaller than this (stops) is left out. */
const EXPOSURE_DEAD_ZONE = 0.2;
/** A tone value smaller than this is left out. */
const TONE_DEAD_ZONE = 5;

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** The display value (0 to 1) below which a share `q` of the pixels lies. */
function percentile(bins: Uint32Array, total: number, q: number): number {
  let seen = 0;
  for (let i = 0; i < bins.length; i++) {
    seen += bins[i] ?? 0;
    if (seen >= q * total) return i / 255;
  }
  return 1;
}

/** The share of the pixels whose value, after `map`, passes `test`. */
function share(bins: Uint32Array, total: number, map: (e: number) => number, test: (e: number) => boolean): number {
  let count = 0;
  bins.forEach((n, i) => {
    if (test(map(i / 255))) count += n;
  });
  return count / total;
}

const deadZone = (value: number) => (Math.abs(value) < TONE_DEAD_ZONE ? 0 : Math.round(value));

/** Exposure in stops: the median into its band, damped, kept from pushing the brightest pixels past white. */
function exposureFor(median: number, brightest: number): number {
  const target = clamp(median, MEDIAN_BAND[0], MEDIAN_BAND[1]);
  const ev = Math.log2(eotf(target) / Math.max(eotf(median), 1e-4)) * EXPOSURE_DAMPING;
  const headroom = Math.log2(eotf(0.98) / Math.max(eotf(brightest), 1e-4));
  const limited = ev > 0 ? Math.min(ev, Math.max(0, headroom) + 0.5) : ev;
  const bounded = clamp(limited, -2, 2);
  return Math.abs(bounded) < EXPOSURE_DEAD_ZONE ? 0 : Math.round(bounded * 100) / 100;
}

/** The proposed light controls for a luminance histogram (256 bins of display-encoded values). */
export function autoTone(luma: Uint32Array): AutoTone {
  const total = luma.reduce((sum, count) => sum + count, 0);
  if (total === 0) return ZERO;
  const at = (q: number) => percentile(luma, total, q);
  const exposure = exposureFor(at(0.5), at(0.995));
  // Where each display value lands after that exposure (the roll-off aside).
  const shift = (e: number) => oetf(Math.min(1, eotf(e) * 2 ** exposure));
  const lo = shift(at(0.005));
  const hi = shift(at(0.995));
  const spread = shift(at(0.95)) - shift(at(0.05));
  const brightShare = share(luma, total, shift, e => e >= 0.92);
  const darkShare = share(luma, total, shift, e => e <= 0.08);
  const clippedHigh = (luma[255] ?? 0) / total;

  // How far the ends are from white and black, in the light table's units, half corrected.
  const whites = hi < 0.9 ? clamp(((0.96 - hi) / (0.15 * hi ** 3 + 0.02)) * 25, 0, 35) : 0;
  const blacks = lo > 0.08 ? -clamp(((lo - 0.03) / (0.15 * (1 - lo) ** 3)) * 30, 0, 40) : 0;
  const highlights = -clamp(Math.max((brightShare - 0.06) * 400, clippedHigh > 0.01 ? 20 : 0), 0, 60);
  const shadows = clamp((darkShare - 0.08) * 300, 0, 50);
  let contrast = 0;
  if (spread < 0.6) contrast = clamp((0.7 - spread) * 120, 0, 35);
  else if (spread > 0.92) contrast = -clamp((spread - 0.88) * 150, 0, 20);

  return {
    exposure,
    contrast: deadZone(contrast),
    highlights: deadZone(highlights),
    shadows: deadZone(shadows),
    whites: deadZone(whites),
    blacks: deadZone(blacks),
  };
}

const PATHS: Readonly<Record<keyof AutoTone, NumberControlPath>> = {
  exposure: "light.exposure",
  contrast: "light.contrast",
  highlights: "light.highlights",
  shadows: "light.shadows",
  whites: "light.whites",
  blacks: "light.blacks",
};

/** `recipe` with its light controls set to Auto's proposal (the rest of the recipe kept). */
export function withAutoTone(recipe: Recipe, tone: AutoTone): Recipe {
  const keys: readonly (keyof AutoTone)[] = ["exposure", "contrast", "highlights", "shadows", "whites", "blacks"];
  return keys.reduce((next, key) => withControl(next, PATHS[key], tone[key]), recipe);
}
