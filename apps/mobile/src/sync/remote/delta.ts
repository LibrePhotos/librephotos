/**
 * Per-entity delta pull loop (doc 03 §2, §3). Requests keyset pages with the
 * stored resume cursor, applies each page in one transaction (via the applier),
 * and advances the cursor until the server reports "caught up"
 * (`next_cursor == null`). The same loop handles the first-login SEED (no stored
 * cursor ⇒ the server streams the whole table and returns `total` for the
 * determinate progress bar) — seed is just "delta from cursor zero".
 *
 * Durable cursor: the server's `next_cursor` token is persisted verbatim as the
 * resume point. We deliberately do NOT reconstruct it from the item's
 * `last_modified`, because that value is ms-truncated on the wire — a bulk
 * mutation can produce >page_size rows sharing an identical ms timestamp, and a
 * truncated cursor would re-request the same page forever. The token preserves
 * the server's full-precision ordering key.
 *
 * 410 `cursor_expired` ⇒ the entity's mirror is cleared and re-seeded from zero
 * once (the mirror is disposable).
 */
import { ApiError } from "@librephotos/api-client";
import type { AppDatabase } from "@/db/types";
import { clearEntity } from "@/db/reset";
import {
  getSyncState,
  upsertSyncState,
  SYNC_ENTITIES,
  type SyncEntity,
} from "@/db/queries/sync-state";
import type { SyncLogEntry } from "@/db/queries/sync-log";
import type { RemoteSyncSource, SyncPullParams } from "./source";
import {
  applyAutoAlbumsPage,
  applyPersonsPage,
  applyPhotosPage,
  applyPlaceAlbumsPage,
  applySharingPage,
  applyThingAlbumsPage,
  applyTagAlbumsPage,
  applyUserAlbumsPage,
  type ApplyResult,
  type PageEnvelope,
} from "./applier";

/** Server caps page_size at 1000; use the max for the fewest seed requests. */
export const DEFAULT_PAGE_SIZE = 1000;

export class SyncAbortedError extends Error {
  constructor() {
    super("sync aborted");
    this.name = "SyncAbortedError";
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SyncAbortedError();
}

function isCursorExpired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 410;
}

export type SyncPhase = "seed" | "delta";

export type SyncProgress = {
  entity: SyncEntity;
  current: number;
  total: number;
  phase: SyncPhase;
};

export type PullOptions = {
  pageSize?: number;
  signal?: AbortSignal;
  now?: number;
  onProgress?: (p: SyncProgress) => void;
  log?: (entry: SyncLogEntry) => void;
};

export type EntityPullResult = {
  entity: SyncEntity;
  applied: number;
  deleted: number;
  pages: number;
  seeded: boolean;
};

/** One page's worth of work — the unit the `remote_delta` job runs. */
export type PullStepResult = {
  entity: SyncEntity;
  applied: number;
  deleted: number;
  /** True when the server reported no next cursor: this entity is caught up. */
  done: boolean;
  /** True when this step started from cursor zero (a seed rather than a delta). */
  seeded: boolean;
  /** True when a 410 forced the entity to be cleared and restarted. */
  reseeded: boolean;
  /** Determinate total the server reported for a seed (0 when unknown). */
  total: number;
};

/**
 * What a pull step needs from one fetched page: the cursor and total that drive
 * the loop, and the entity's applier already bound to that very page.
 */
type FetchedPage = {
  next_cursor: string | null;
  total?: number;
  apply: (db: AppDatabase, now: number) => ApplyResult;
};

type EntityHandler = (params: SyncPullParams) => Promise<FetchedPage>;

/**
 * Pair an entity's fetcher with its page applier. The shared type parameter is
 * the guarantee: `apply` only ever receives the envelope its own `fetch`
 * produced, so no entity's page can reach another entity's applier.
 */
function bindHandler<E extends PageEnvelope<unknown>>(
  fetch: (params: SyncPullParams) => Promise<E>,
  apply: (db: AppDatabase, env: E, now: number) => ApplyResult
): EntityHandler {
  return async (params) => {
    const env = await fetch(params);
    return {
      next_cursor: env.next_cursor,
      total: env.total,
      apply: (db, now) => apply(db, env, now),
    };
  };
}

/** Bind an entity to its source fetcher + page applier. */
function handlerFor(source: RemoteSyncSource, entity: SyncEntity): EntityHandler {
  switch (entity) {
    case "photo":
      return bindHandler((p) => source.photos(p), applyPhotosPage);
    case "person":
      return bindHandler((p) => source.persons(p), applyPersonsPage);
    case "user_album":
      return bindHandler((p) => source.userAlbums(p), applyUserAlbumsPage);
    case "auto_album":
      return bindHandler((p) => source.autoAlbums(p), applyAutoAlbumsPage);
    case "thing_album":
      return bindHandler((p) => source.thingAlbums(p), applyThingAlbumsPage);
    case "place_album":
      return bindHandler((p) => source.placeAlbums(p), applyPlaceAlbumsPage);
    case "tag_album":
      return bindHandler((p) => source.tagAlbums(p), applyTagAlbumsPage);
    case "sharing":
      return bindHandler((p) => source.sharing(p), applySharingPage);
  }
}

export type PullStepOptions = PullOptions & {
  /**
   * Restart the entity's progress counters at zero — set on the first step of a
   * pass. Progress is durable (it lives in `sync_state`), so a resumed pass must
   * *not* reset it or the seed bar would restart from zero on every app launch.
   */
  resetProgress?: boolean;
  /** Allow one 410-driven reseed. The caller tracks "once" across steps. */
  allowReseed?: boolean;
};

/**
 * Fetch and apply exactly ONE page for an entity, then return.
 *
 * This is the resumable unit the `remote_delta` job runs, and it is why the
 * queue can promise sub-second jobs against a 1000-row page. Everything it needs
 * to resume — the keyset cursor, the accumulated count, the determinate total —
 * already lives in `sync_state`, written inside the applier's transaction, so a
 * step is a pure function of the durable state plus one HTTP response. Killing
 * the app between steps costs at most one page.
 */
export async function pullEntityStep(
  db: AppDatabase,
  source: RemoteSyncSource,
  entity: SyncEntity,
  opts: PullStepOptions = {}
): Promise<PullStepResult> {
  const now = opts.now ?? Date.now();
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const fetchPage = handlerFor(source, entity);

  const prev = getSyncState(db, entity);
  const cursor: string | null = prev?.cursor_id ?? null;
  const seeded = cursor == null;
  const base = opts.resetProgress ? 0 : (prev?.progress_current ?? 0);
  let total = opts.resetProgress && seeded ? 0 : (prev?.progress_total ?? 0);

  // Initialise the row so the applier's in-transaction cursor UPDATE has a row
  // to hit. cursor_id is COALESCE-preserved by upsertSyncState.
  upsertSyncState(db, entity, {
    status: "running",
    cursor_modified: prev?.cursor_modified ?? null,
    last_full_sync: prev?.last_full_sync ?? null,
    progress_current: base,
    progress_total: total,
  });

  throwIfAborted(opts.signal);

  let page: FetchedPage;
  try {
    page = await fetchPage({ cursor, pageSize });
  } catch (err) {
    if (isCursorExpired(err) && opts.allowReseed !== false) {
      // The mirror is disposable: drop this entity and restart from zero. Not
      // "done" — the caller re-enters and the next step seeds.
      clearEntity(db, entity);
      upsertSyncState(db, entity, { status: "running", progress_current: 0, progress_total: 0 });
      opts.log?.({ op: "reseed", entity, level: "warn", message: "cursor_expired" });
      return { entity, applied: 0, deleted: 0, done: false, seeded: true, reseeded: true, total: 0 };
    }
    upsertSyncState(db, entity, {
      status: "error",
      progress_current: base,
      progress_total: total,
    });
    throw err;
  }

  // Seed (cursorless) first page carries the determinate total.
  if (cursor == null && page.total != null) total = page.total;

  const res = page.apply(db, now);
  const applied = base + res.applied;
  const done = page.next_cursor == null;

  upsertSyncState(db, entity, {
    status: done ? "done" : "running",
    last_full_sync: done ? now : (prev?.last_full_sync ?? null),
    progress_current: applied,
    progress_total: Math.max(total, applied),
  });
  opts.onProgress?.({
    entity,
    current: applied,
    total: Math.max(total, applied),
    phase: seeded ? "seed" : "delta",
  });

  return {
    entity,
    applied: res.applied,
    deleted: res.deleted,
    done,
    seeded,
    reseeded: false,
    total,
  };
}

/**
 * Pull one entity to quiescence by running {@link pullEntityStep} until the
 * server says it is caught up. Resumes from the stored cursor; on 410 clears the
 * entity and re-seeds from zero (once). Idempotent + cancellable.
 *
 * The job queue drives the steps individually instead; this loop remains for the
 * callers that legitimately want the whole entity in one await — the background
 * task's photo top-up and the post-upload timeline refresh.
 */
export async function pullEntity(
  db: AppDatabase,
  source: RemoteSyncSource,
  entity: SyncEntity,
  opts: PullOptions = {}
): Promise<EntityPullResult> {
  const wallStart = Date.now();
  let didReseed = false;
  let applied = 0;
  let deleted = 0;
  let pages = 0;
  let seeded = (getSyncState(db, entity)?.cursor_id ?? null) == null;
  let first = true;

  for (;;) {
    throwIfAborted(opts.signal);
    const step = await pullEntityStep(db, source, entity, {
      ...opts,
      resetProgress: first,
      allowReseed: !didReseed,
    });
    first = false;
    if (step.reseeded) {
      didReseed = true;
      seeded = true;
      applied = 0;
      deleted = 0;
      pages = 0;
      first = true;
      continue;
    }
    applied += step.applied;
    deleted += step.deleted;
    pages += 1;
    if (step.done) break;
  }

  const durableCursor = getSyncState(db, entity)?.cursor_id ?? null;
  opts.log?.({
    op: seeded ? "seed" : "pull",
    entity,
    applied,
    deleted,
    durationMs: Date.now() - wallStart,
    cursor: durableCursor,
    message: `${pages} page(s)`,
  });

  return { entity, applied, deleted, pages, seeded };
}

export type PullAllResult = {
  entities: EntityPullResult[];
  applied: number;
  deleted: number;
};

/** Pull every entity in dependency order (doc 03 §1). */
export async function pullAll(
  db: AppDatabase,
  source: RemoteSyncSource,
  opts: PullOptions = {}
): Promise<PullAllResult> {
  const entities: EntityPullResult[] = [];
  for (const entity of SYNC_ENTITIES) {
    throwIfAborted(opts.signal);
    entities.push(await pullEntity(db, source, entity, opts));
  }
  return {
    entities,
    applied: entities.reduce((a, e) => a + e.applied, 0),
    deleted: entities.reduce((a, e) => a + e.deleted, 0),
  };
}
