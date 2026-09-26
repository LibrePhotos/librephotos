/**
 * Job kinds, priorities, and sizing constants for the durable sync queue
 * (doc 03 §1).
 *
 * ## Why a queue at all
 *
 * The sync pipeline used to be a strict `await` chain — outbox → remote delta →
 * device scan → hashing → uploads → thumbs. On a real 2867-photo library that
 * design failed in three compounding ways: hashing sat behind a full camera-roll
 * enumeration, uploads sat behind hashing and so never began, and the only
 * record of progress was the JS call stack, which a reload discards. The user
 * watched 161 photos get hashed, reloaded, and the counter never moved again.
 *
 * Replacing the driver with a queue fixes all three by construction: every unit
 * of work is a durable row, the worker picks the highest-priority *eligible*
 * job rather than the next link in a chain, and a killed process resumes from
 * the table instead of from zero.
 *
 * ## Sizing rule
 *
 * **One job run must finish well under a second.** That is what keeps the UI
 * responsive and what makes an interrupted run cheap — at most one job's worth
 * of work is lost. Anything unbounded is split: a job does one chunk and
 * enqueues its own continuation. The budgets below are chosen so the slowest
 * plausible device still clears each one inside that envelope.
 */

/** Every job kind, in priority order (see {@link JOB_PRIORITY}). */
export const JOB_KINDS = [
  "outbox_replay",
  "reseed_check",
  "remote_delta",
  "device_scan",
  "hash_batch",
  "upload_asset",
  "thumb_prefetch",
  "integrity_check",
] as const;

export type JobKind = (typeof JOB_KINDS)[number];

export type JobState = "pending" | "running" | "done" | "failed";

/**
 * Lower runs first. Ties break on `next_attempt_at`, then insertion order.
 *
 * Two rules are encoded here, and the second one is subtle enough to be worth
 * spelling out because getting it wrong reproduces the original bug.
 *
 * **1. Work the user is looking at outranks work done on their behalf.**
 * Pushing local mutations and pulling the remote delta feed the timeline, so
 * they come first and the timeline stays responsive even while a 2867-photo
 * scan grinds away behind them. Thumbs and the integrity snapshot are pure
 * nice-to-haves and yield to everything.
 *
 * **2. The three background stages share one priority, on purpose.**
 * `device_scan`, `hash_batch` and `upload_asset` each enqueue their own
 * continuation. Give them distinct priorities and the best-ranked one
 * monopolises the worker forever — scanning would run to completion before
 * hashing began, and hashing before uploading, which is *precisely* the strict
 * chain this queue replaced, just re-implemented in data. Sharing a priority
 * makes the tie-break insertion order, so a continuation goes to the back of the
 * class and the three stages round-robin: scan a chunk, hash a batch, upload a
 * photo, repeat. That is what makes uploads begin while hashing is still
 * running instead of after it finishes.
 */
export const JOB_PRIORITY: Record<JobKind, number> = {
  outbox_replay: 10,
  reseed_check: 15,
  remote_delta: 20,
  // ── one band: round-robin, see rule 2 above ──
  device_scan: 60,
  hash_batch: 60,
  upload_asset: 60,
  // ─────────────────────────────────────────────
  thumb_prefetch: 90,
  integrity_check: 95,
};

/* ---------------------------------------------------------------------- *
 * Per-kind work budgets — the "well under a second" contract
 * ---------------------------------------------------------------------- */

/** Outbox rows drained per `outbox_replay` run (each is one small HTTP call). */
export const OUTBOX_BUDGET = 10;
/**
 * Assets enumerated per `device_scan` chunk. Was 400, which was roughly a second
 * of enumeration plus 800 SQLite row writes on an iPhone 11 — over budget, and
 * a coarse granularity to interrupt a scan at. 150 is ~1.5 provider pages.
 *
 * This is a *starting* value: `sizing.ts` measures what a chunk actually costs on
 * this device and converges on {@link JOB_TARGET_MS}.
 */
export const SCAN_CHUNK = 150;
/**
 * Assets hashed per `hash_batch` — md5 over every byte of each photo, the
 * heaviest unit in the app. Was 50, i.e. potentially hundreds of MB read and 50
 * bridge round trips (more on iOS, where a `ph://` asset may first have to come
 * back from iCloud) in what is supposed to be a sub-second job. 8 is a
 * conservative start; `sizing.ts` adapts it from the measured duration.
 */
export const HASH_BATCH_SIZE = 8;
/** Thumbnails downloaded per `thumb_prefetch` run. */
export const THUMB_BATCH = 12;
/**
 * How many `upload_asset` jobs may be live at once. A window rather than "one
 * job per queued asset": 2867 upload jobs would swamp the round-robin and push
 * scanning and hashing to the back of a very long line. Each upload chains the
 * next, so the window refills itself and the stage never stalls.
 */
export const UPLOAD_WINDOW = 4;
/** How long a gate-blocked upload waits before asking again (no Wi-Fi / power). */
export const GATE_RETRY_MS = 60_000;

/** Attempts before a job is parked in the terminal `failed` state. */
export const MAX_JOB_ATTEMPTS = 5;
/** Backoff base (ms): delay = base * 2^(attempts-1), capped by MAX_BACKOFF_MS. */
export const JOB_BACKOFF_BASE_MS = 5_000;
/** Ceiling on the backoff window, so a long-parked job still retries this session. */
export const MAX_BACKOFF_MS = 5 * 60_000;

export function jobBackoffDelay(
  attempts: number,
  base = JOB_BACKOFF_BASE_MS,
  cap = MAX_BACKOFF_MS
): number {
  return Math.min(cap, base * 2 ** Math.max(0, attempts - 1));
}

/* ---------------------------------------------------------------------- *
 * Payloads
 * ---------------------------------------------------------------------- */

/**
 * Per-kind payload shapes. Payloads carry only *resume position*, never data
 * that also lives in a table — a job must be able to run correctly after a
 * restart, reading current truth from SQLite rather than from a stale snapshot
 * frozen into its own row.
 */
export type JobPayloads = {
  outbox_replay: Record<string, never>;
  reseed_check: Record<string, never>;
  /** One entity's next delta page. The cursor itself lives in `sync_state`. */
  remote_delta: { entity: string };
  /** Chunk index, for observability only — the watermark lives in `app_meta`. */
  device_scan: { chunk: number };
  hash_batch: Record<string, never>;
  upload_asset: { assetId: string };
  thumb_prefetch: Record<string, never>;
  integrity_check: Record<string, never>;
};

/** A job to enqueue: kind + payload, with priority/dedupe derived by default. */
export type JobSpec<K extends JobKind = JobKind> = {
  kind: K;
  payload?: JobPayloads[K];
  /** Override the kind's default priority (rarely needed). */
  priority?: number;
  /** Override the derived dedupe key (rarely needed). */
  dedupeKey?: string;
  /** Earliest ms-epoch this job may run. Default: immediately. */
  notBefore?: number;
};

/**
 * Identity of a unit of work. Two enqueues with the same key while one is still
 * live are the same request, so the second is dropped.
 *
 * `device_scan` and `hash_batch` key on the kind alone: "scan the next chunk" is
 * a single outstanding intention no matter how many triggers ask for it.
 * `remote_delta` keys per entity and `upload_asset` per asset, because those
 * genuinely are independent units that should run in parallel over time.
 */
export function dedupeKeyFor<K extends JobKind>(kind: K, payload?: JobPayloads[K]): string {
  switch (kind) {
    case "remote_delta":
      return `remote_delta:${(payload as JobPayloads["remote_delta"] | undefined)?.entity ?? ""}`;
    case "upload_asset":
      return `upload_asset:${(payload as JobPayloads["upload_asset"] | undefined)?.assetId ?? ""}`;
    default:
      return kind;
  }
}

/** A claimed job, as the worker sees it. */
export type JobRow = {
  id: number;
  kind: JobKind;
  dedupe_key: string;
  payload: string | null;
  state: JobState;
  priority: number;
  attempts: number;
  next_attempt_at: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  last_error: string | null;
};

/** Parse a row's payload, tolerating null/garbage (a bad payload must not wedge). */
export function jobPayload<K extends JobKind>(row: JobRow): Partial<JobPayloads[K]> {
  if (!row.payload) return {};
  try {
    return JSON.parse(row.payload) as Partial<JobPayloads[K]>;
  } catch {
    return {};
  }
}
