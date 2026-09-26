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
import { createTestDb, type TestDb } from "@/db/test-db";
import { timelinePage } from "@/db/queries/timeline";
import {
  createChangeHub,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_QUIET_MS,
  type ChangeHub,
  type DbChangeSubscribe,
} from "@/db/live-query";
import { insertLocalAlbum, insertLocalAsset, remotePhoto, seedRemotePhotos } from "./fixtures";

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
function commitPhotos(t: TestDb, emit: (table: string) => void, ids: string[]): void {
  seedRemotePhotos(
    t.db,
    ids.map((id, i) => remotePhoto({ id, timestamp: Date.UTC(2024, 0, 1) + i }))
  );
  // sqlite3_update_hook fires once per row, which is the whole problem.
  for (let i = 0; i < ids.length; i += 1) emit("remote_photo");
}

function photoCount(t: TestDb): number {
  return (t.db.get(sql`SELECT COUNT(*) AS c FROM remote_photo`) as { c: number }).c;
}

describe("change hub: a per-row event storm becomes a handful of flushes", () => {
  let t: TestDb;
  let hub: ChangeHub | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
    t = createTestDb();
  });
  afterEach(() => {
    hub?.close();
    hub = null;
    jest.useRealTimers();
    t.close();
  });

  it("collapses 2867 row events into a handful of timeline queries, and still lands on the final state", () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    // Make the timeline take its expensive MERGED shape (the UNION ALL), which
    // is what the per-row storm was re-running thousands of times.
    insertLocalAsset(t.db, { id: "local-1", hash: null });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["local-1"] });

    let runs = 0;
    let lastSeen = -1;
    hub.watch(["remote_photo"], () => {
      runs += 1;
      lastSeen = timelinePage(t.db, { limit: 5_000 }).rows.length;
    });

    // The maintainer's library, one update-hook event per row, committed in
    // page-sized transactions exactly like the scan does.
    const TOTAL = 2_867;
    const CHUNK = 50;
    for (let i = 0; i < TOTAL; i += CHUNK) {
      const ids = Array.from({ length: Math.min(CHUNK, TOTAL - i) }, (_, k) =>
        `p${String(i + k).padStart(4, "0")}`
      );
      commitPhotos(t, emitter.row, ids);
      // Rows land far faster than the debounce; a little wall-clock passes so
      // the max-wait ceiling still fires periodically, like a real scan.
      jest.advanceTimersByTime(2);
    }
    // The burst ends; the trailing flush must arrive.
    jest.advanceTimersByTime(DEFAULT_QUIET_MS + 1);

    // Before the fix this was one full merged-timeline query per row: 2867 of
    // them. Two orders of magnitude fewer is the whole point.
    expect(runs).toBeLessThan(TOTAL / 100);
    expect(runs).toBeGreaterThan(0);
    // …and the UI still converged on the truth: every photo plus the local asset.
    expect(photoCount(t)).toBe(TOTAL);
    expect(lastSeen).toBe(TOTAL + 1);
  });

  it("runs the query exactly once for a burst that arrives inside one quiet period", () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    let runs = 0;
    hub.watch(null, () => {
      runs += 1;
    });

    for (let i = 0; i < 200; i += 1) emitter.row("local_asset");
    expect(runs).toBe(0); // nothing has run yet — the burst is still being absorbed
    jest.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(runs).toBe(1);
  });

  it("keeps repainting under a continuous stream instead of debouncing forever", () => {
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
      jest.advanceTimersByTime(step);
    }

    // Progress stays visible — this is what stops "fix the jank by making the
    // scan invisible". Roughly one flush per max-wait window.
    expect(runs).toBeGreaterThanOrEqual(3);
    expect(runs).toBeLessThanOrEqual(10);
  });

  it("observes the final write even when it arrives at the very end of a storm", () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    let lastSeen = -1;
    hub.watch(["remote_photo"], () => {
      lastSeen = photoCount(t);
    });

    commitPhotos(t, emitter.row, Array.from({ length: 50 }, (_, i) => `a${i}`));
    jest.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(lastSeen).toBe(50);

    // One straggler well after the storm — the classic "dropped final update".
    commitPhotos(t, emitter.row, ["final"]);
    jest.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(lastSeen).toBe(51);
  });
});

describe("change hub: table scoping", () => {
  let hub: ChangeHub | null = null;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    hub?.close();
    hub = null;
    jest.useRealTimers();
  });

  it("skips a watcher whose tables were not touched", () => {
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
    jest.advanceTimersByTime(DEFAULT_QUIET_MS + 1);

    expect(localRuns).toBe(1);
    expect(remoteRuns).toBe(0); // the scan must not re-run the memories card
  });

  it("wakes an undeclared watcher on any change", () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    let runs = 0;
    hub.watch(null, () => {
      runs += 1;
    });

    emitter.row("job_queue");
    jest.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(runs).toBe(1);
  });

  it("wakes every watcher when the source does not name the table", () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    let remoteRuns = 0;
    hub.watch(["remote_photo"], () => {
      remoteRuns += 1;
    });

    emitter.row(); // unknown table ⇒ fail safe, re-run everything
    jest.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(remoteRuns).toBe(1);
  });

  it("wakes a watcher when any one of several changed tables matches", () => {
    const emitter = makeEmitter();
    hub = createChangeHub({ subscribe: emitter.subscribe });

    let runs = 0;
    hub.watch(["local_album"], () => {
      runs += 1;
    });

    emitter.row("job_queue");
    emitter.row("sync_log");
    emitter.row("local_album");
    jest.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(runs).toBe(1);
  });
});

describe("change hub: interaction deferral", () => {
  let hub: ChangeHub | null = null;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    hub?.close();
    hub = null;
    jest.useRealTimers();
  });

  it("holds a flush back while the user is interacting, then flushes promptly", () => {
    const emitter = makeEmitter();
    let interacting = true;
    hub = createChangeHub({ subscribe: emitter.subscribe, defer: () => interacting });

    let runs = 0;
    hub.watch(null, () => {
      runs += 1;
    });

    emitter.row("local_asset");
    jest.advanceTimersByTime(DEFAULT_QUIET_MS * 3);
    expect(runs).toBe(0); // no reflow under the scrolling finger

    interacting = false;
    jest.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(runs).toBe(1); // …and it catches up as soon as the gesture ends
  });

  it("never defers past the cap, so a continuously-scrolling user still sees progress", () => {
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
    jest.advanceTimersByTime(400);
    expect(runs).toBe(1);
  });
});

describe("change hub: lifecycle", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("stops flushing after close and unsubscribes from the source", () => {
    const emitter = makeEmitter();
    const hub = createChangeHub({ subscribe: emitter.subscribe });
    let runs = 0;
    hub.watch(null, () => {
      runs += 1;
    });

    emitter.row("local_asset");
    hub.close();
    jest.advanceTimersByTime(DEFAULT_QUIET_MS * 5);
    expect(runs).toBe(0);

    emitter.row("local_asset");
    jest.advanceTimersByTime(DEFAULT_QUIET_MS * 5);
    expect(runs).toBe(0);
  });

  it("does not wake a watcher that unsubscribed during the burst", () => {
    const emitter = makeEmitter();
    const hub = createChangeHub({ subscribe: emitter.subscribe });
    let runs = 0;
    const unwatch = hub.watch(null, () => {
      runs += 1;
    });

    emitter.row("local_asset");
    unwatch();
    jest.advanceTimersByTime(DEFAULT_QUIET_MS + 1);
    expect(runs).toBe(0);
    hub.close();
  });

  it("keeps notifying the other watchers when one query throws", () => {
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
    expect(() => jest.advanceTimersByTime(DEFAULT_QUIET_MS + 1)).toThrow("bad query");
    expect(healthyRuns).toBe(1);
    hub.close();
  });
});
