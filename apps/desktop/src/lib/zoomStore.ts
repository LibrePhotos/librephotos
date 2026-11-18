import { useSyncExternalStore } from "react";

/**
 * The zoom percentage for the top-bar readout. The stage writes it on every wheel tick; only the
 * readout subscribes, so zooming re-renders one tiny component instead of the app.
 */
let percent: number | null = null;
const listeners = new Set<() => void>();

export function setZoomPercent(next: number | null): void {
  const rounded = next === null ? null : Math.round(next);
  if (rounded === percent) return;
  percent = rounded;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useZoomPercent(): number | null {
  return useSyncExternalStore(subscribe, () => percent);
}
