/**
 * @jest-environment node
 *
 * Live-query coalescing — cover for "scanning the camera roll makes the app very
 * unresponsive".
 *
 * expo-sqlite's change listener is `sqlite3_update_hook`, so it fires once per
 * changed ROW. A 2867-photo scan therefore emitted >10 000 notifications, each
 * synchronously re-running every mounted reactive query — including the merged
 * timeline `UNION ALL`, which materialises and sorts the whole library.
 *
 * These tests drive the hub with a real better-sqlite3 database and the real
 * timeline query, and pin the two properties that make coalescing safe:
 *
 *   1. a storm of row events produces *far* fewer query runs, and
 *   2. the last run still observes the final state — coalescing may drop
 *      redundant work, never the final update.
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../testing";
import { timelinePage } from "../queries/timeline";
import {
  createChangeHub,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_QUIET_MS,
  type ChangeHub,
  type DbChangeSubscribe,
} from "../change-hub";
import { insertLocalAlbum, insertLocalAsset, remotePhoto, seedRemotePhotos } from "../fixtures";

/** A manual stand-in for expo-sqlite's per-row change source. */
function makeEmitter() {
  const listeners = new Set<(table?: string) => void>();
  const subscribe: DbChangeSubscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return {
    subscribe,
    /** One changed row, exactly as the update hook reports it. */
    row(table?: string) {
      for (const l of [...listeners]) l(table);
    },
  };
}

/** Commit one transaction's worth of photos and emit its per-row change events. */
async function commitPhotos(t: TestDb, emit: (table: string) => void, ids: string[]): Promise<void> {
  await seedRemotePhotos(
    t.db,
    ids.map((id, i) => remotePhoto({ id, timestamp: Date.UTC(2024, 0, 1) + i }))
  );
  // sqlite3_update_hook fires once per row, which is the whole problem.
  for (let i = 0; i < ids.length; i += 1) emit("remote_photo");
}

async function photoCount(t: TestDb): Promise<number> {
  return (await t.db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM remote_photo`)).c;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

describe("change hub: a per-row event storm becomes a handful of flushes", () => {
  let t: TestDb;
  let hub: ChangeHub | null = null;

  beforeEach(async () => {
    vi.useFakeTimers();
    t = createTestDb();
  });
  afterEach(async () => {
    hub?.close();
    hub = null;
    vi.useRealTimers();
    t.close();
  });

  it("collapses 2867 row events into a handful of timeline queries, and still lands on the final state", async () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    // Make the timeline take its expensive MERGED shape (the UNION ALL), which
    // is what the per-row storm was re-running thousands of times.
    await insertLocalAsset(t.db, { id: "local-1", hash: null });
    await insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["local-1"] });

    let runs = 0;
    let lastSeen = -1;
    hub.watch(["remote_photo"], () => {
      runs += 1;
      void timelinePage(t.db, { limit: 5_000 }).then((page) => {
        lastSeen = page.rows.length;
      });
    });

    // The maintainer's library, one update-hook event per row, committed in
    // page-sized transactions exactly like the scan does.
    const TOTAL = 2_867;
    const CHUNK = 50;
    for (let i = 0; i < TOTAL; i += CHUNK) {
      const ids = Array.from({ length: Math.min(CHUNK, TOTAL - i) }, (_, k) =>
        `p${String(i + k).padStart(4, "0")}`
      );
      await commitPhotos(t, emitter.row, ids);
      // Rows land far faster than the debounce; a little wall-clock passes so
      // the max-wait ceiling still fires periodically, like a real scan.
      vi.advanceTimersByTime(2);
    }
    vi.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    await settle();

    // Before the fix this was one full merged-timeline query per row: 2867 of
    // them. Two orders of magnitude fewer is the whole point.
    expect(runs).toBeLessThan(TOTAL / 100);
    expect(runs).toBeGreaterThan(0);
    // …and the UI still converged on the truth: every photo plus the local asset.
    expect(await photoCount(t)).toBe(TOTAL);
    expect(lastSeen).toBe(TOTAL + 1);
  });

  it("runs the query exactly once for a burst that arrives inside one quiet period", async () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    let runs = 0;
    hub.watch(null, () => {
      runs += 1;
    });

    for (let i = 0; i < 200; i += 1) emitter.row("local_asset");
    expect(runs).toBe(0); // nothing has run yet — the burst is still being absorbed
    vi.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(runs).toBe(1);
  });

  it("keeps repainting under a continuous stream instead of debouncing forever", async () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    let runs = 0;
    hub.watch(null, () => {
      runs += 1;
    });

    // A write every half quiet-period: a pure trailing debounce would never fire.
    const step = Math.floor(DEFAULT_QUIET_MS / 2);
    for (let elapsed = 0; elapsed < DEFAULT_MAX_WAIT_MS * 4; elapsed += step) {
      emitter.row("local_asset");
      vi.advanceTimersByTime(step);
    }

    // Progress stays visible — this is what stops "fix the jank by making the
    // scan invisible". Roughly one flush per max-wait window.
    expect(runs).toBeGreaterThanOrEqual(3);
    expect(runs).toBeLessThanOrEqual(10);
  });

  it("observes the final write even when it arrives at the very end of a storm", async () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    let lastSeen = -1;
    hub.watch(["remote_photo"], () => {
      void photoCount(t).then((n) => {
        lastSeen = n;
      });
    });

    await commitPhotos(t, emitter.row, Array.from({ length: 50 }, (_, i) => `a${i}`));
    vi.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    await settle();
    expect(lastSeen).toBe(50);

    // One straggler well after the storm — the classic "dropped final update".
    await commitPhotos(t, emitter.row, ["final"]);
    vi.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    await settle();
    expect(lastSeen).toBe(51);
  });
});

describe("change hub: table scoping", () => {
  let hub: ChangeHub | null = null;
  beforeEach(() => vi.useFakeTimers());
  afterEach(async () => {
    hub?.close();
    hub = null;
    vi.useRealTimers();
  });

  it("skips a watcher whose tables were not touched", async () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    let remoteRuns = 0;
    let localRuns = 0;
    hub.watch(["remote_photo"], () => {
      remoteRuns += 1;
    });
    hub.watch(["local_asset"], () => {
      localRuns += 1;
    });

    emitter.row("local_asset");
    vi.advanceTimersByTime(DEFAULT_QUIET_MS + 1);

    expect(localRuns).toBe(1);
    expect(remoteRuns).toBe(0); // the scan must not re-run the memories card
  });

  it("wakes an undeclared watcher on any change", async () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    let runs = 0;
    hub.watch(null, () => {
      runs += 1;
    });

    emitter.row("job_queue");
    vi.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(runs).toBe(1);
  });

  it("wakes every watcher when the source does not name the table", async () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    let remoteRuns = 0;
    hub.watch(["remote_photo"], () => {
      remoteRuns += 1;
    });

    emitter.row(); // unknown table ⇒ fail safe, re-run everything
    vi.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(remoteRuns).toBe(1);
  });

  it("wakes a watcher when any one of several changed tables matches", async () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    let runs = 0;
    hub.watch(["local_album"], () => {
      runs += 1;
    });

    emitter.row("job_queue");
    emitter.row("sync_log");
    emitter.row("local_album");
    vi.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(runs).toBe(1);
  });
});

describe("change hub: interaction deferral", () => {
  let hub: ChangeHub | null = null;
  beforeEach(() => vi.useFakeTimers());
  afterEach(async () => {
    hub?.close();
    hub = null;
    vi.useRealTimers();
  });

  it("holds a flush back while the user is interacting, then flushes promptly", async () => {
    const emitter = makeEmitter();
    let interacting = true;
    hub = createChangeHub({ subscribe: emitter.subscribe, defer: () => interacting });

    let runs = 0;
    hub.watch(null, () => {
      runs += 1;
    });

    emitter.row("local_asset");
    vi.advanceTimersByTime(DEFAULT_QUIET_MS * 3);
    expect(runs).toBe(0); // no reflow under the scrolling finger

    interacting = false;
    vi.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(runs).toBe(1); // …and it catches up as soon as the gesture ends
  });

  it("never defers past the cap, so a continuously-scrolling user still sees progress", async () => {
    const emitter = makeEmitter();
    hub = createChangeHub({
      subscribe: emitter.subscribe,
      defer: () => true, // the user never stops scrolling
      deferCapMs: 300,
    });

    let runs = 0;
    hub.watch(null, () => {
      runs += 1;
    });

    emitter.row("local_asset");
    vi.advanceTimersByTime(400);
    expect(runs).toBe(1);
  });
});

describe("change hub: lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stops flushing after close and unsubscribes from the source", async () => {
    const emitter = makeEmitter();
    const hub = createChangeHub({ subscribe: emitter.subscribe });
    let runs = 0;
    hub.watch(null, () => {
      runs += 1;
    });

    emitter.row("local_asset");
    hub.close();
    vi.advanceTimersByTime(DEFAULT_QUIET_MS * 5);
    expect(runs).toBe(0);

    emitter.row("local_asset");
    vi.advanceTimersByTime(DEFAULT_QUIET_MS * 5);
    expect(runs).toBe(0);
  });

  it("does not wake a watcher that unsubscribed during the burst", async () => {
    const emitter = makeEmitter();
    const hub = createChangeHub({ subscribe: emitter.subscribe });
    let runs = 0;
    const unwatch = hub.watch(null, () => {
      runs += 1;
    });

    emitter.row("local_asset");
    unwatch();
    vi.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(runs).toBe(0);
    hub.close();
  });

  it("keeps notifying the other watchers when one query throws", async () => {
    const emitter = makeEmitter();
    const hub = createChangeHub({ subscribe: emitter.subscribe });
    let healthyRuns = 0;
    hub.watch(null, () => {
      throw new Error("bad query");
    });
    hub.watch(null, () => {
      healthyRuns += 1;
    });

    emitter.row("local_asset");
    expect(() => vi.advanceTimersByTime(DEFAULT_QUIET_MS + 1)).toThrow("bad query");
    expect(healthyRuns).toBe(1);
    hub.close();
  });
});
