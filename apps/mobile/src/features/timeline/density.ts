import { create } from "zustand";
import { preferencesStorage } from "@/lib/preferencesStorage";

/**
 * How dense the timeline grid is. Pinching moves one step: pinch out (zoom
 * in) for bigger photos grouped by day, pinch in (zoom out) for small tiles
 * grouped by month and then by year, the way Google Photos and Apple Photos
 * let you sweep through years.
 */
export type GroupBy = "day" | "month" | "year";
export type Density = { columns: number; groupBy: GroupBy };

export const DENSITIES: readonly Density[] = [
  { columns: 2, groupBy: "day" },
  { columns: 3, groupBy: "day" },
  { columns: 5, groupBy: "month" },
  { columns: 7, groupBy: "year" },
];

/** The default: three columns by day, as before. */
export const DEFAULT_DENSITY_LEVEL = 1;

/** Pinch scale past which the grid changes one step. */
const ZOOM_IN_SCALE = 1.25;
const ZOOM_OUT_SCALE = 0.8;

/** The level after a pinch that ended at `scale` (1 = no change). */
export function levelAfterPinch(level: number, scale: number): number {
  if (scale >= ZOOM_IN_SCALE) return Math.max(0, level - 1);
  if (scale <= ZOOM_OUT_SCALE) return Math.min(DENSITIES.length - 1, level + 1);
  return level;
}

/** The group a `YYYY-MM-DD` day falls into at this grouping. */
export function groupKey(day: string, groupBy: GroupBy): string {
  if (groupBy === "year") return day.slice(0, 4);
  if (groupBy === "month") return day.slice(0, 7);
  return day;
}

const STORAGE_KEY = "librephotos.timelineDensity";

export function parseDensityLevel(raw: string | null): number {
  const n = raw == null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 && n < DENSITIES.length ? n : DEFAULT_DENSITY_LEVEL;
}

type DensityState = {
  level: number;
  setLevel: (level: number) => void;
};

/** The chosen density, kept across restarts. */
export const useDensityStore = create<DensityState>((set) => ({
  level: parseDensityLevel(preferencesStorage.getSync(STORAGE_KEY)),
  setLevel: (level) => {
    set({ level });
    void preferencesStorage.set(STORAGE_KEY, String(level));
  },
}));
