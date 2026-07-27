/**
 * @jest-environment node
 *
 * Interaction back-off. The queue always yielded between jobs, but a macrotask
 * yield only *shares* the thread — it does not prioritise anyone, so a scan ran
 * at identical speed whether the user was staring at a static screen or dragging
 * the timeline. These tests pin the policy that fixes that, and the two safety
 * properties that keep it from turning "janky" into "stalled":
 *
 *   1. a yield holds a job back for at most the cap, so a user who never stops
 *      scrolling still sees progress, and
 *   2. a full drain still completes while the user interacts throughout.
 */
import { createTestDb, type TestDb } from "@/db/test-db";
import { enqueueJobs } from "../jobs/queue";
import { runWorker, resetBootReclaimForTests } from "../jobs/worker";
import {
  clearInteraction,
  createAdaptiveYield,
  INTERACTION_WINDOW_MS,
  isInteracting,
  noteInteraction,
  resetActivityForTests,
} from "../activity";

/** A controllable clock + sleep, so no test waits on real time. */
function fakeClock() {
  let now = 1_000;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    /** Sleeps advance the clock rather than blocking. */
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe("interaction signal", () => {
  beforeEach(() => resetActivityForTests());

  it("is false before anything has been touched", () => {
    expect(isInteracting(5_000)).toBe(false);
  });

  it("is true inside the window after a touch and false outside it", () => {
    noteInteraction(1_000);
    expect(isInteracting(1_000)).toBe(true);
    expect(isInteracting(1_000 + INTERACTION_WINDOW_MS - 1)).toBe(true);
    expect(isInteracting(1_000 + INTERACTION_WINDOW_MS)).toBe(false);
  });

  it("is cleared when the app goes to the background", () => {
    noteInteraction(1_000);
    clearInteraction();
    // Backgrounded: the queue's short OS window must not be spent waiting out a
    // touch nobody is making any more.
    expect(isInteracting(1_000)).toBe(false);
  });
});

describe("adaptive yield", () => {
  it("returns after a single macrotask when the user is idle", async () => {
    const clock = fakeClock();
    const yieldFn = createAdaptiveYield({
      isInteracting: () => false,
      sleep: clock.sleep,
      now: clock.now,
    });

    const before = clock.now();
    await yieldFn();
    // Idle (or backgrounded) means full speed: nothing is held back.
    expect(clock.now() - before).toBe(0);
  });

  it("holds the next job back for as long as the user keeps scrolling", async () => {
    const clock = fakeClock();
    const startedAt = clock.now();
    const stopAt = startedAt + 300; // the user scrolls for 300ms, then lifts off
    const yieldFn = createAdaptiveYield({
      isInteracting: () => clock.now() < stopAt,
      sleep: clock.sleep,
      now: clock.now,
      busySliceMs: 100,
      maxHoldMs: 1_500,
    });

    await yieldFn();
    const held = clock.now() - startedAt;
    expect(held).toBeGreaterThanOrEqual(300); // it waited out the gesture…
    expect(held).toBeLessThan(400); // …and not one slice longer than that.
  });

  it("never holds longer than the cap, so a constant scroller still sees progress", async () => {
    const clock = fakeClock();
    const yieldFn = createAdaptiveYield({
      isInteracting: () => true, // the user never stops
      sleep: clock.sleep,
      now: clock.now,
      busySliceMs: 100,
      maxHoldMs: 1_500,
    });

    const before = clock.now();
    await yieldFn();
    const held = clock.now() - before;
    expect(held).toBeGreaterThanOrEqual(1_500);
    // …and it is a cap, not an open-ended wait.
    expect(held).toBeLessThanOrEqual(1_600);
  });

  it("resumes within one slice of the last touch", async () => {
    const clock = fakeClock();
    let touches = 2; // two more slices' worth of scrolling, then done
    const yieldFn = createAdaptiveYield({
      isInteracting: () => touches-- > 0,
      sleep: clock.sleep,
      now: clock.now,
      busySliceMs: 100,
      maxHoldMs: 1_500,
    });

    const before = clock.now();
    await yieldFn();
    expect(clock.now() - before).toBe(100);
  });
});

describe("back-off never stalls the pipeline", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    resetBootReclaimForTests();
    resetActivityForTests();
  });
  afterEach(() => t.close());

  it("drains a chain of jobs even while the user interacts throughout", async () => {
    const clock = fakeClock();
    // The worst case for the policy: the user scrolls for the entire scan.
    const yieldFn = createAdaptiveYield({
      isInteracting: () => true,
      sleep: clock.sleep,
      now: clock.now,
      busySliceMs: 100,
      maxHoldMs: 1_500,
    });

    let remaining = 12;
    enqueueJobs(t.db, [{ kind: "device_scan", payload: { chunk: 0 } }], Date.now());

    const stats = await runWorker(t.db, {
      yield: yieldFn,
      handlers: {
        device_scan: async () => {
          remaining -= 1;
          return remaining > 0
            ? { enqueue: [{ kind: "device_scan", payload: { chunk: 12 - remaining } as never }] }
            : {};
        },
      },
    });

    // Every job ran: back-off delays work, it never drops it.
    expect(stats.processed).toBe(12);
    expect(stats.succeeded).toBe(12);
    expect(stats.stoppedReason).toBe("drained");
    // And it cost roughly the cap per job — bounded, predictable, not a freeze.
    expect(clock.now()).toBeLessThanOrEqual(1_000 + 12 * 1_600);
  });
});
