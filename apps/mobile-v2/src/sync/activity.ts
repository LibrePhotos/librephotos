/**
 * User-activity signal, and the worker yield built on it.
 *
 * The job queue already yields between jobs so React can commit, but a
 * macrotask yield only shares the thread — it does not *prioritise* anyone. A
 * camera-roll scan therefore ran at exactly the same rate whether the user was
 * staring at a static screen or dragging the timeline, which is the difference
 * between "a scan is running" and "the app is janky".
 *
 * So: while the user is actively touching the app, background jobs back off and
 * wait in short slices; the moment they stop, work resumes. Backgrounded or idle,
 * nothing holds it back at all and the scan runs at full speed — which is when
 * we want it running anyway.
 *
 * Two properties matter more than the tuning:
 *
 *   - **it cannot deadlock the pipeline.** A single yield holds a job back for
 *     at most {@link DEFAULT_MAX_HOLD_MS}, so a user who scrolls without pause
 *     still gets a steady drip of progress rather than a frozen counter.
 *   - **it resumes promptly.** The wait is a poll on short slices, not a wait
 *     for an event, so work restarts within one slice of the last touch.
 *
 * Pure: no react-native import, injectable clock and sleep, so the whole thing
 * is Node-tested. The app feeds it real touches from the lists and the root
 * touch sniffer; `sync/run` hands the yield to the worker.
 */

/**
 * How long after a touch the user still counts as "interacting". Long enough to
 * span the gaps between the discrete scroll events of one flick, short enough
 * that work restarts as soon as the finger really is gone.
 */
export const INTERACTION_WINDOW_MS = 400;

/** Slice the worker waits in while the user is busy. */
export const DEFAULT_BUSY_SLICE_MS = 100;

/** Longest one yield may hold a job back, however long the user keeps scrolling. */
export const DEFAULT_MAX_HOLD_MS = 1_500;

let lastInteractionAt = 0;
let lastScrollAt = 0;

/**
 * Record a user interaction — any touch. Cheap by design: it is called from
 * handlers that fire many times a second, so it does nothing but stamp a number.
 */
export function noteInteraction(now: number = Date.now()): void {
  lastInteractionAt = now;
}

/**
 * Record a *scroll*, which is an interaction and then some.
 *
 * The two are tracked separately on purpose. Backing background work off is
 * right for any touch, but holding a live-query re-run back is only right while
 * the content is moving: a tap that favourites a photo is itself a write, and
 * deferring its flush would leave the user's own action un-reflected for a
 * second. Scrolling is the one case where re-querying actively hurts, because it
 * reflows the list under their finger.
 */
export function noteScroll(now: number = Date.now()): void {
  lastScrollAt = now;
  lastInteractionAt = now;
}

/** True while the user is (or has just been) touching the app. */
export function isInteracting(now: number = Date.now()): boolean {
  return lastInteractionAt > 0 && now - lastInteractionAt < INTERACTION_WINDOW_MS;
}

/** True while content is (or has just been) moving under the user's finger. */
export function isScrolling(now: number = Date.now()): boolean {
  return lastScrollAt > 0 && now - lastScrollAt < INTERACTION_WINDOW_MS;
}

/**
 * Forget any in-flight interaction. Called when the app is backgrounded: nobody
 * is looking, so background work should go full speed immediately rather than
 * spend its short OS window waiting out a stale touch.
 */
export function clearInteraction(): void {
  lastInteractionAt = 0;
  lastScrollAt = 0;
}

/** Test seam. */
export function resetActivityForTests(): void {
  clearInteraction();
}

export type AdaptiveYieldOptions = {
  /** Defaults to the module-level signal fed by the UI. */
  isInteracting?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  busySliceMs?: number;
  maxHoldMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Build the worker's between-jobs yield. Always hands the thread back once (the
 * macrotask the queue already relied on), then — and only while the user is
 * interacting — waits in slices before letting the next job start.
 */
export function createAdaptiveYield(opts: AdaptiveYieldOptions = {}): () => Promise<void> {
  const busy = opts.isInteracting ?? (() => isInteracting());
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const sliceMs = opts.busySliceMs ?? DEFAULT_BUSY_SLICE_MS;
  const maxHoldMs = opts.maxHoldMs ?? DEFAULT_MAX_HOLD_MS;

  return async () => {
    // The unconditional macrotask: React must be able to commit between jobs
    // whether or not anyone is touching the screen.
    await sleep(0);
    if (!busy()) return;

    const startedAt = now();
    // Poll rather than await an event, so the very next slice after the finger
    // lifts starts work again — no lingering pause the user would read as a stall.
    while (busy() && now() - startedAt < maxHoldMs) {
      await sleep(sliceMs);
    }
  };
}
