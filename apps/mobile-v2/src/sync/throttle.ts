/**
 * Pure throttle gate for the foreground sync trigger (doc 03 §1: "app
 * foreground, throttled ≥1 min"). Kept RN-free so it is unit-tested under Node,
 * separately from the react-native AppState wiring in ./triggers.
 */

/** Minimum gap (ms) between foreground-triggered syncs. */
export const FOREGROUND_THROTTLE_MS = 60_000;

/**
 * A single-slot rate limiter: `tryRun(now)` returns true and records the time
 * when at least `gapMs` has elapsed since the last accepted run, else false.
 */
export function createThrottle(gapMs = FOREGROUND_THROTTLE_MS) {
  // Start "long ago" so the first call always passes.
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    tryRun(now = Date.now()): boolean {
      if (now - lastAt < gapMs) return false;
      lastAt = now;
      return true;
    },
    reset(): void {
      lastAt = Number.NEGATIVE_INFINITY;
    },
  };
}
