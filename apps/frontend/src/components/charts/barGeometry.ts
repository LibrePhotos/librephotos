/**
 * The geometry of the statistics bar charts, drawn as plain SVG (EventCountMonthGraph,
 * LocationDurationStackedBar): the value axis, the bars' slots, and a bar's outline.
 */

/** The value axis: its top value and the values that get a gridline and a label. */
export type ValueAxis = Readonly<{ max: number; ticks: readonly number[] }>;

/** The round steps an axis may take, times a power of ten. */
const STEP_FACTORS = [1, 2, 2.5, 3, 5, 10];

/**
 * A value axis for counts from 0 to `dataMax`: at most `maxTicks` whole, round steps (1, 2, 2.5, 3 or
 * 5 times a power of ten) above 0, the top the first step at or above the highest bar.
 */
export function valueAxis(dataMax: number, maxTicks = 4): ValueAxis {
  if (dataMax <= 0) return { max: 1, ticks: [0, 1] };
  const rough = dataMax / maxTicks;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(
    1,
    STEP_FACTORS.map(factor => factor * power).find(candidate => candidate >= rough && Number.isInteger(candidate)) ??
      10 * power
  );
  const max = Math.ceil(dataMax / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_unused, i) => i * step);
  return { max, ticks };
}

/** Where a bar sits along the axis: its slot and the bar centred in it. */
export type BarSlot = Readonly<{ slotX: number; slotWidth: number; x: number; width: number }>;

/**
 * `count` equal slots over `width` from `left`, each holding a bar that leaves `gapShare` of the slot
 * empty and is never wider than `maxBarWidth`.
 */
export function barSlots(count: number, left: number, width: number, gapShare: number, maxBarWidth: number): BarSlot[] {
  const slotWidth = count > 0 ? width / count : 0;
  const barWidth = Math.min(maxBarWidth, slotWidth * (1 - gapShare));
  return Array.from({ length: count }, (_unused, i) => {
    const slotX = left + i * slotWidth;
    return { slotX, slotWidth, x: slotX + (slotWidth - barWidth) / 2, width: barWidth };
  });
}

/** The index of the slot under `x`, kept inside the slots. */
export function slotAt(x: number, left: number, slotWidth: number, count: number): number {
  if (count === 0 || slotWidth <= 0) return -1;
  return Math.min(count - 1, Math.max(0, Math.floor((x - left) / slotWidth)));
}

/** A bar from `bottom` up `height`, its top corners rounded by up to `radius`. */
export function barPath(x: number, bottom: number, width: number, height: number, radius: number): string {
  if (height <= 0 || width <= 0) return "";
  const r = Math.min(radius, width / 2, height);
  const top = bottom - height;
  return [
    `M${x},${bottom}`,
    `V${top + r}`,
    `Q${x},${top} ${x + r},${top}`,
    `H${x + width - r}`,
    `Q${x + width},${top} ${x + width},${top + r}`,
    `V${bottom}`,
    "Z",
  ].join("");
}
