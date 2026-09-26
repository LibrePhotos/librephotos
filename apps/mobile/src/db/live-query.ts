/**
 * Live-query change coalescing — the fix for "scanning the camera roll makes the
 * app very unresponsive".
 *
 * ## What was actually wrong
 *
 * `useReactiveQuery` re-runs its query whenever the database changes, and the
 * change source is expo-sqlite's `addDatabaseChangeListener`. That listener is
 * **`sqlite3_update_hook`**: it fires once per *changed row*, not once per
 * commit — the event payload literally carries a `rowId`. So a camera-roll scan
 * of a 2867-photo library does not produce "a notification per page"; it
 * produces one per row:
 *
 *   - `upsertLocalAssets` — 1 event per asset      (~2 900)
 *   - `linkAlbumAssets`   — 1 event per membership (~2 900)
 *   - the hash pass       — 1 event per `UPDATE`   (~2 900)
 *   - upload_queue / job_queue / sync_log churn on top
 *
 * ...comfortably over 10 000 events, each of which synchronously re-ran *every*
 * mounted reactive query and re-rendered its list. The most expensive of those
 * is the merged timeline, a `UNION ALL` with no inner `LIMIT` that materialises
 * every remote photo plus every local asset and sorts the lot in a temp B-tree.
 * Running that ten thousand times on the JS thread is the jank.
 *
 * ## The fix
 *
 * One hub sits between the raw per-row event source and the queries. It absorbs
 * the storm and emits *flushes*:
 *
 *   - **trailing debounce** (`quietMs`) — a burst becomes one flush;
 *   - **max wait** (`maxWaitMs`) — under a *continuous* stream the debounce
 *     would never settle, so a flush is forced at least this often. This is what
 *     keeps the scan visible: photos still appear while it runs;
 *   - **table scoping** — the hook may declare the tables its query reads, so a
 *     write to `local_asset` need not re-run a query that only reads
 *     `remote_photo`. A watcher that declares nothing is woken by everything,
 *     and an event that does not name a table wakes everyone. Both defaults fail
 *     safe (an extra re-run, never a missed one);
 *   - **interaction deferral** (`defer`) — re-querying mid-gesture reflows the
 *     list under the user's finger, so a flush can be held while they scroll,
 *     capped by `deferCapMs` so progress never stalls outright.
 *
 * ## Why coalescing cannot drop the final update
 *
 * A flush carries no data. It is purely a signal to re-read, and the re-read
 * hits the live database at the moment it runs. So the *content* of a flush is
 * always current state, never a queued snapshot, and merging ten flushes into
 * one loses nothing but redundant work.
 *
 * The remaining question is only whether a flush is guaranteed to *happen* after
 * the last change. It is: every change (re-)arms the timer, and the timer is
 * only ever cancelled by another change that arms it again, or by `close()`. So
 * after the final change at time T a flush runs no later than T + `quietMs`
 * (T + `deferCapMs` if the user is still mid-gesture) and observes final state.
 *
 * Pure TypeScript — no React, no expo — so the whole thing is Node-tested with
 * fake timers against a real better-sqlite3 database.
 */

/**
 * Raw database change source. The listener is called once per changed row; the
 * table name is passed when the source knows it (expo-sqlite does). Calling the
 * listener with no argument means "something changed, table unknown", which
 * conservatively wakes every watcher.
 */
export type DbChangeSubscribe = (listener: (tableName?: string) => void) => () => void;

/** Quiet period that ends a burst. About one frame at 10fps — imperceptible. */
export const DEFAULT_QUIET_MS = 90;
/** Longest a *continuous* write stream may go without repainting. */
export const DEFAULT_MAX_WAIT_MS = 450;
/** Longest a flush may be held back for an in-progress gesture. */
export const DEFAULT_DEFER_CAP_MS = 1_500;

export type ChangeHubOptions = {
  subscribe: DbChangeSubscribe;
  quietMs?: number;
  maxWaitMs?: number;
  deferCapMs?: number;
  /**
   * Returns true while the user is actively interacting. A flush is postponed
   * (up to {@link ChangeHubOptions.deferCapMs}) while it does, so background
   * writes cannot reflow a list mid-scroll.
   */
  defer?: () => boolean;
};

export type ChangeHub = {
  /**
   * Register a listener. `tables` narrows it to writes touching those tables;
   * `null` means "wake on any change" (the safe default).
   */
  watch(tables: readonly string[] | null, listener: () => void): () => void;
  /** Flush immediately if anything is pending (used by tests and forced refreshes). */
  flushNow(): void;
  /** Stop listening and cancel any pending flush. */
  close(): void;
};

type Watcher = { tables: ReadonlySet<string> | null; listener: () => void };

export function createChangeHub(opts: ChangeHubOptions): ChangeHub {
  const quietMs = opts.quietMs ?? DEFAULT_QUIET_MS;
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const deferCapMs = opts.deferCapMs ?? DEFAULT_DEFER_CAP_MS;

  const watchers = new Set<Watcher>();

  /** Tables touched since the last flush. Meaningless while `wakeAll`. */
  let dirtyTables = new Set<string>();
  /** An un-named table was changed ⇒ this flush must wake every watcher. */
  let wakeAll = false;
  let dirty = false;
  /** When the current un-flushed burst started, for the max-wait ceiling. */
  let burstStartedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function clearTimer(): void {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Does a watcher care about the tables this flush covers? */
  function matches(want: ReadonlySet<string> | null, changed: ReadonlySet<string> | null): boolean {
    // Either side being "unknown/everything" is the fail-safe case: re-run.
    if (want == null || changed == null) return true;
    for (const table of changed) if (want.has(table)) return true;
    return false;
  }

  function flush(): void {
    clearTimer();
    if (!dirty) return;

    const changed = wakeAll ? null : dirtyTables;
    // Reset *before* notifying: a listener that writes to the DB itself must
    // start a fresh burst rather than have its own change swallowed by the
    // flush that is still in progress.
    dirtyTables = new Set();
    wakeAll = false;
    dirty = false;
    burstStartedAt = 0;

    // Snapshot: a listener may unsubscribe (or mount) others while running.
    let firstError: unknown = null;
    let failed = false;
    for (const watcher of [...watchers]) {
      if (!watchers.has(watcher)) continue; // unsubscribed by an earlier listener
      if (!matches(watcher.tables, changed)) continue;
      try {
        watcher.listener();
      } catch (err) {
        // One broken query must not leave every other screen stale. Keep going,
        // then surface the first failure rather than swallowing it.
        if (!failed) {
          failed = true;
          firstError = err;
        }
      }
    }
    if (failed) throw firstError;
  }

  /** Delay before the next flush attempt, honouring debounce, ceiling and defer. */
  function nextWait(elapsed: number): number {
    if (opts.defer?.()) {
      // Mid-gesture: re-check after a quiet period instead of flushing, but
      // never hold past the cap — a user who scrolls continuously must still
      // see the scan making progress.
      return Math.max(0, Math.min(quietMs, deferCapMs - elapsed));
    }
    return Math.min(quietMs, Math.max(0, maxWaitMs - elapsed));
  }

  function onTimer(): void {
    timer = null;
    if (closed) return;
    const elapsed = Date.now() - burstStartedAt;
    // The gesture may have started after the timer was armed; re-check here so
    // deferral responds to the *current* state, not the state at arming time.
    if (opts.defer?.() && elapsed < deferCapMs) {
      arm();
      return;
    }
    flush();
  }

  /** (Re-)arm the trailing timer. Called on every change, so the debounce resets. */
  function arm(): void {
    if (closed || !dirty) return;
    clearTimer();
    timer = setTimeout(onTimer, nextWait(Date.now() - burstStartedAt));
  }

  const unsubscribe = opts.subscribe((tableName?: string) => {
    if (closed) return;
    if (tableName == null) wakeAll = true;
    else if (!wakeAll) dirtyTables.add(tableName);
    if (!dirty) {
      dirty = true;
      burstStartedAt = Date.now();
    }
    arm();
  });

  return {
    watch(tables, listener) {
      const watcher: Watcher = { tables: tables ? new Set(tables) : null, listener };
      watchers.add(watcher);
      return () => {
        watchers.delete(watcher);
      };
    },
    flushNow: flush,
    close() {
      if (closed) return;
      closed = true;
      clearTimer();
      watchers.clear();
      unsubscribe();
    },
  };
}
