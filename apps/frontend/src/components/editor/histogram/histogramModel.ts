/**
 * The histogram as the panel draws it: one SVG path per channel, scaled so a spike of clipped
 * pixels at either end does not flatten the rest, and whether the shadows or the highlights clip.
 */
import type { Histogram } from "../engine/histogram";

export type HistogramChannel = keyof Histogram;

/** The share of the pixels at 0 (or 255) in some channel from which that end counts as clipped. */
const CLIP_SHARE = 0.002;

/** The pixels a histogram counts. */
export function pixelCount(histogram: Histogram): number {
  return histogram.luma.reduce((sum, count) => sum + count, 0);
}

/** The tallest bin between the ends, so a clipped end draws past the top instead of squashing the rest. */
function peak(bins: Uint32Array): number {
  let tallest = 1;
  for (let i = 1; i < bins.length - 1; i++) tallest = Math.max(tallest, bins[i] ?? 0);
  return tallest;
}

/**
 * The closed outline of one channel over a `width` x `height` box: bin `i` at `x = i (width / 255)`,
 * its count up from the bottom, scaled by `scale` (default: the channel's own peak between the ends).
 */
export function histogramPath(bins: Uint32Array, width: number, height: number, scale = peak(bins)): string {
  const step = width / Math.max(1, bins.length - 1);
  const points = Array.from(bins, (count, i) => {
    const y = height - Math.min(1, count / scale) * height;
    return `L${(i * step).toFixed(2)} ${y.toFixed(2)}`;
  });
  return `M0 ${height} ${points.join(" ")} L${width} ${height} Z`;
}

/** The common scale of several channels drawn over each other: the tallest of their peaks. */
export function sharedScale(histogram: Histogram, channels: readonly HistogramChannel[]): number {
  return Math.max(1, ...channels.map(channel => peak(histogram[channel])));
}

export type Clipping = Readonly<{ shadows: boolean; highlights: boolean }>;

/** Whether a visible share of the pixels sits at 0 (shadows) or 255 (highlights) in any of red, green, blue. */
export function clippingOf(histogram: Histogram): Clipping {
  const total = pixelCount(histogram);
  if (total === 0) return { shadows: false, highlights: false };
  const at = (bin: number) => Math.max(histogram.r[bin] ?? 0, histogram.g[bin] ?? 0, histogram.b[bin] ?? 0) / total;
  return { shadows: at(0) > CLIP_SHARE, highlights: at(255) > CLIP_SHARE };
}
