import { useSyncExternalStore } from "react";

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
