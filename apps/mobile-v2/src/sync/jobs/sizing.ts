/**
 * Adaptive work-unit sizing — keeping the "one job finishes well under a second"
 * contract honest on real hardware.
 *
 * The budgets in ./types are guesses about the slowest plausible device, and the
 * first on-device run showed how wrong a guess can be: a 50-asset `hash_batch`
 * is 50 md5 passes over whole photos, each of which may first have to materialise
 * a `ph://` asset out of iCloud. That is seconds of work, not the sub-second
 * envelope the queue is designed around, and an oversized unit is felt directly
 * — it is the granularity at which background work can be interrupted for the
 * user, and the granularity at which an interrupted run loses progress.
 *
 * Rather than pick another fixed guess, the sizer measures. Each job kind starts
 * at a conservative budget and is nudged toward {@link JOB_TARGET_MS} using the
 * duration the last run actually took:
 *
 *   - a job that came in fast grows its budget (fewer, fuller units);
 *   - a job that ran long shrinks it (finer interruption granularity).
 *
 * Two guards keep it stable. The per-sample move is damped to at most 2x in
 * either direction, so a single iCloud-stalled hash cannot collapse the budget
 * to the floor and a single cache hit cannot inflate it. And every budget is
 * clamped to a hand-checked [min, max], so the controller can never wander
 * somewhere absurd.
 *
 * State is per-process and deliberately not persisted: it converges within a
 * couple of jobs, and starting from the safe initial value after a reload is the
 * right behaviour anyway (the device may be in a different thermal or power
 * state than it was last launch).
 *
 * Pure — no DB, no clock of its own. The worker feeds it durations; the handlers
 * read budgets from it. An explicit `budgets` override in the seams bypasses it
 * entirely, which is what keeps the pipeline tests deterministic.
 */
import { HASH_BATCH_SIZE, SCAN_CHUNK, THUMB_BATCH, type JobKind } from "./types";

/**
 * What one job run should aim to take. Comfortably inside the "well under a
 * second" contract, with room for the controller to overshoot without breaking it.
 */
export const JOB_TARGET_MS = 400;

/**
 * Above this, a job is logged as slow rather than merely timed. This is the line
 * that makes an oversized unit *findable* in an exported sync log instead of
 * something the maintainer has to eyeball 500 rows to notice.
 */
export const JOB_SLOW_MS = 1_000;

export type BudgetSpec = {
  /** Starting budget for a fresh process. */
  initial: number;
  /** Never shrink below this — a unit still has to make progress. */
  min: number;
  /** Never grow past this — the ceiling the code was reasoned about at. */
  max: number;
};

/**
 * The kinds whose budget is worth adapting: the two that dominate a first scan.
 * Everything else (outbox rows, upload window) is bounded by network latency
 * rather than by how much local work we hand it, so a fixed budget is fine.
 */
export const JOB_BUDGET_SPECS: Partial<Record<JobKind, BudgetSpec>> = {
  // A chunk is metadata enumeration plus two SQLite row writes per asset.
  device_scan: { initial: SCAN_CHUNK, min: 25, max: 400 },
  // A batch is md5 over every byte of each photo — by far the heaviest unit.
  hash_batch: { initial: HASH_BATCH_SIZE, min: 2, max: 50 },
  // Network-bound, but a stalled CDN should still not wedge a job for a minute.
  thumb_prefetch: { initial: THUMB_BATCH, min: 4, max: 32 },
};

/**
 * One measured sample → the next budget. Exported for its own tests: this is the
 * only piece with any arithmetic in it.
 */
export function adjustBudget(
  current: number,
  durationMs: number,
  spec: BudgetSpec,
  targetMs = JOB_TARGET_MS
): number {
  // A zero/negative/NaN duration says nothing (a no-op job, or a clock that went
  // backwards). Keep what we have rather than react to noise.
  if (!Number.isFinite(durationMs) || durationMs <= 0) return current;
  const ratio = targetMs / durationMs;
  // Damping: one unusually slow or fast sample moves the budget by at most 2x.
  const damped = Math.min(2, Math.max(0.5, ratio));
  const next = Math.round(current * damped);
  return Math.min(spec.max, Math.max(spec.min, next));
}

export type JobSizer = {
  /** Current budget for a kind, or undefined when the kind is not adapted. */
  budgetFor(kind: JobKind): number | undefined;
  /** Record how long one run of `kind` took, and re-size accordingly. */
  observe(kind: JobKind, durationMs: number): void;
  /** Current budgets, for logging and tests. */
  snapshot(): Partial<Record<JobKind, number>>;
  /** Back to the initial budgets. */
  reset(): void;
};

export function createJobSizer(
  specs: Partial<Record<JobKind, BudgetSpec>> = JOB_BUDGET_SPECS,
  targetMs = JOB_TARGET_MS
): JobSizer {
  const budgets = new Map<JobKind, number>();
  const seed = () => {
    budgets.clear();
    for (const [kind, spec] of Object.entries(specs) as [JobKind, BudgetSpec][]) {
      budgets.set(kind, spec.initial);
    }
  };
  seed();

  return {
    budgetFor(kind) {
      return budgets.get(kind);
    },
    observe(kind, durationMs) {
      const spec = specs[kind];
      const current = budgets.get(kind);
      if (!spec || current == null) return;
      budgets.set(kind, adjustBudget(current, durationMs, spec, targetMs));
    },
    snapshot() {
      return Object.fromEntries(budgets) as Partial<Record<JobKind, number>>;
    },
    reset: seed,
  };
}

/**
 * Process-wide sizer. Module-level for the same reason the worker's boot reclaim
 * is: "how big a unit does this phone handle" is a fact about the device, not
 * about any one sync run, and re-learning it from scratch on every trigger would
 * mean never learning it at all.
 */
export const jobSizer = createJobSizer();

/** Test seam: forget everything the sizer learned. */
export function resetJobSizerForTests(): void {
  jobSizer.reset();
}
