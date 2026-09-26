/**
 * @jest-environment node
 *
 * Work-unit sizing. The queue's whole design rests on "one job run finishes well
 * under a second" — that is what makes background work interruptible for the
 * user and an interrupted run cheap. The shipped budgets did not hold on real
 * hardware: a 400-asset scan chunk and a 50-photo hash batch (md5 over every
 * byte, plus an iCloud materialisation per `ph://` asset) are seconds of work.
 *
 * These tests pin the new starting sizes and the controller that corrects them.
 */
import { createTestDb, type TestDb } from "@/db/test-db";
import { syncDeviceMedia } from "@/sync/device/media-sync";
import { FakeMedia, asset } from "@/sync/device/__tests__/fake-media";
import { HASH_BATCH_SIZE, SCAN_CHUNK } from "../types";
import {
  adjustBudget,
  createJobSizer,
  JOB_BUDGET_SPECS,
  JOB_SLOW_MS,
  JOB_TARGET_MS,
  type BudgetSpec,
} from "../sizing";

const SPEC: BudgetSpec = { initial: 100, min: 10, max: 400 };

describe("work-unit budgets", () => {
  it("starts every adapted kind inside the sub-second contract", () => {
    // Regression guard on the two numbers the device report was about. If these
    // ever grow back, the jank comes back with them.
    expect(SCAN_CHUNK).toBeLessThanOrEqual(200);
    expect(HASH_BATCH_SIZE).toBeLessThanOrEqual(10);
    expect(JOB_TARGET_MS).toBeLessThan(JOB_SLOW_MS);
    expect(JOB_SLOW_MS).toBeLessThanOrEqual(1_000);
  });

  it("keeps every spec's initial value within its own clamps", () => {
    for (const [kind, spec] of Object.entries(JOB_BUDGET_SPECS)) {
      expect(spec!.min).toBeLessThanOrEqual(spec!.initial);
      expect(spec!.initial).toBeLessThanOrEqual(spec!.max);
      expect(spec!.min).toBeGreaterThan(0);
      expect(kind).toBeTruthy();
    }
  });
});

describe("adjustBudget", () => {
  it("shrinks a budget that overran the target", () => {
    expect(adjustBudget(100, JOB_TARGET_MS * 2, SPEC)).toBe(50);
  });

  it("grows a budget that came in fast", () => {
    expect(adjustBudget(100, JOB_TARGET_MS / 2, SPEC)).toBe(200);
  });

  it("leaves a budget that hit the target alone", () => {
    expect(adjustBudget(100, JOB_TARGET_MS, SPEC)).toBe(100);
  });

  it("damps a single catastrophic sample to a halving, not a collapse", () => {
    // One asset stuck behind an iCloud download must not drive the batch to 1.
    expect(adjustBudget(100, JOB_TARGET_MS * 100, SPEC)).toBe(50);
  });

  it("damps a single suspiciously fast sample to a doubling", () => {
    expect(adjustBudget(100, 1, SPEC)).toBe(200);
  });

  it("clamps to the spec's floor and ceiling", () => {
    expect(adjustBudget(SPEC.min, JOB_TARGET_MS * 10, SPEC)).toBe(SPEC.min);
    expect(adjustBudget(SPEC.max, 1, SPEC)).toBe(SPEC.max);
  });

  it("ignores a sample that says nothing", () => {
    expect(adjustBudget(100, 0, SPEC)).toBe(100);
    expect(adjustBudget(100, -5, SPEC)).toBe(100);
    expect(adjustBudget(100, Number.NaN, SPEC)).toBe(100);
  });
});

describe("job sizer", () => {
  it("converges on the target from a budget that is far too big", () => {
    const sizer = createJobSizer({ hash_batch: { initial: 400, min: 2, max: 400 } });
    // A device where each unit of work costs 40ms: the right budget is ~10.
    const costPerUnit = 40;
    for (let i = 0; i < 12; i += 1) {
      const budget = sizer.budgetFor("hash_batch")!;
      sizer.observe("hash_batch", budget * costPerUnit);
    }
    const settled = sizer.budgetFor("hash_batch")!;
    expect(settled).toBeGreaterThanOrEqual(8);
    expect(settled).toBeLessThanOrEqual(12);
  });

  it("converges on the target from a budget that is far too small", () => {
    const sizer = createJobSizer({ hash_batch: { initial: 2, min: 2, max: 400 } });
    const costPerUnit = 4; // a fast device — it should earn a bigger budget
    for (let i = 0; i < 12; i += 1) {
      const budget = sizer.budgetFor("hash_batch")!;
      sizer.observe("hash_batch", budget * costPerUnit);
    }
    const settled = sizer.budgetFor("hash_batch")!;
    expect(settled).toBeGreaterThanOrEqual(80);
    expect(settled).toBeLessThanOrEqual(120);
  });

  it("never leaves the clamps however extreme the samples", () => {
    const sizer = createJobSizer({ device_scan: { initial: 100, min: 25, max: 400 } });
    for (let i = 0; i < 50; i += 1) sizer.observe("device_scan", 60_000);
    expect(sizer.budgetFor("device_scan")).toBe(25);
    for (let i = 0; i < 50; i += 1) sizer.observe("device_scan", 1);
    expect(sizer.budgetFor("device_scan")).toBe(400);
  });

  it("ignores kinds it does not adapt", () => {
    const sizer = createJobSizer({ device_scan: { initial: 100, min: 25, max: 400 } });
    expect(sizer.budgetFor("upload_asset")).toBeUndefined();
    sizer.observe("upload_asset", 5_000); // must not throw or invent a budget
    expect(sizer.budgetFor("upload_asset")).toBeUndefined();
  });

  it("resets to the initial budgets", () => {
    const sizer = createJobSizer({ device_scan: { initial: 100, min: 25, max: 400 } });
    sizer.observe("device_scan", 60_000);
    expect(sizer.budgetFor("device_scan")).toBe(50);
    sizer.reset();
    expect(sizer.budgetFor("device_scan")).toBe(100);
    expect(sizer.snapshot()).toEqual({ device_scan: 100 });
  });
});

describe("the scan budget is a cap, not a suggestion", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("stops at the budget instead of overshooting by up to a whole page", () => {
    const media = new FakeMedia();
    media.setAlbum(
      "cam",
      "Camera",
      Array.from({ length: 500 }, (_, i) => asset(`p${String(i).padStart(4, "0")}`, { creationTime: 1_000 + i }))
    );

    // Budget deliberately not a multiple of the page size: the old code read a
    // whole page before checking, so a 150 budget against 100-asset pages did
    // 200 assets of work.
    return syncDeviceMedia(t.db, media, { pageSize: 100, maxAssetsPerRun: 150 }).then((result) => {
      expect(result.scanned).toBe(150);
      expect(result.complete).toBe(false); // the rest resumes on the next chunk
      // …and it got there by asking the provider for exactly that many.
      const asked = media.queries.filter((q) => q.first > 1).reduce((sum, q) => sum + q.first, 0);
      expect(asked).toBe(150);
    });
  });

  it("still reports a library that fits inside the budget as complete", () => {
    const media = new FakeMedia();
    media.setAlbum(
      "cam",
      "Camera",
      Array.from({ length: 40 }, (_, i) => asset(`p${i}`, { creationTime: 1_000 + i }))
    );
    return syncDeviceMedia(t.db, media, { pageSize: 100, maxAssetsPerRun: 150 }).then((result) => {
      // 80 records read, not 40: the synthetic whole-library album and the user
      // album both enumerate the same photos. The cross-album `seen` dedupe is
      // what keeps that from becoming 80 rows.
      expect(result.scanned).toBe(80);
      expect(result.upserted).toBe(40);
      expect(result.complete).toBe(true);
    });
  });
});
