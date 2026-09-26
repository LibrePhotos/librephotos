/**
 * @jest-environment node
 *
 * Observability. The Sync status and Backup screens have to answer three
 * questions at a glance — **which stage is running, how far along it is, and
 * what is blocking it** — and every fraction they show must have a real,
 * fixed denominator.
 *
 * The bug being pinned: the old Backup screen showed `on_server / hashed`, a
 * fraction whose denominator *grew as hashing proceeded*, so a 2867-photo
 * library read "0/161" and the maintainer had to ask what it meant.
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { insertLocalAlbum, insertLocalAsset, remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";
import { getBackupConfig, setBackupConfig } from "@/db/queries/backup";
import { backupState } from "@/sync/upload/status";
import { claimNextJob, enqueueJob, enqueueJobs, failJob } from "../queue";
import { MAX_JOB_ATTEMPTS } from "../types";
import { hashCounts, jobQueueSnapshot, scanCounts, syncStages, thumbCounts } from "../status";

describe("jobQueueSnapshot", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("reports queue depth per kind, in priority order", () => {
    enqueueJobs(t.db, [
      { kind: "thumb_prefetch" },
      { kind: "upload_asset", payload: { assetId: "a1" } },
      { kind: "upload_asset", payload: { assetId: "a2" } },
      { kind: "remote_delta", payload: { entity: "photo" } },
    ]);
    const snap = jobQueueSnapshot(t.db);

    expect(snap.depth.map((d) => d.kind)).toEqual(["remote_delta", "upload_asset", "thumb_prefetch"]);
    expect(snap.depth.find((d) => d.kind === "upload_asset")?.pending).toBe(2);
    expect(snap.totals).toEqual({ pending: 4, running: 0, done: 0, failed: 0 });
  });

  it("names the job currently in flight", () => {
    enqueueJob(t.db, { kind: "device_scan", payload: { chunk: 3 } });
    claimNextJob(t.db, 5_000);
    const snap = jobQueueSnapshot(t.db);

    expect(snap.inFlight).toHaveLength(1);
    expect(snap.inFlight[0].kind).toBe("device_scan");
    expect(snap.inFlight[0].startedAt).toBe(5_000);
    expect(JSON.parse(snap.inFlight[0].payload!)).toEqual({ chunk: 3 });
    expect(snap.totals.running).toBe(1);
  });

  it("surfaces failures with their reason, marking which have given up", () => {
    enqueueJobs(t.db, [
      { kind: "upload_asset", payload: { assetId: "a1" } },
      { kind: "hash_batch" },
    ]);
    const retrying = claimNextJob(t.db, 1_000)!;
    failJob(t.db, retrying, "network unreachable", 1_000);
    const dead = claimNextJob(t.db, 1_000)!;
    failJob(t.db, { id: dead.id, attempts: MAX_JOB_ATTEMPTS }, "file unreadable", 1_000);

    const snap = jobQueueSnapshot(t.db);
    expect(snap.failures).toHaveLength(2);
    // Terminal failures sort first — they are the ones the user must act on.
    expect(snap.failures[0]).toMatchObject({
      kind: "hash_batch",
      lastError: "file unreadable",
      terminal: true,
    });
    expect(snap.failures[1]).toMatchObject({
      kind: "upload_asset",
      lastError: "network unreachable",
      terminal: false,
    });
    // A job still in its backoff window is reported too: "nothing is happening
    // and nothing says why" is the exact failure this screen exists to prevent.
    expect(snap.failures[1].nextAttemptAt).toBeGreaterThan(1_000);
  });

  it("reports when the next backoff window opens", () => {
    enqueueJob(t.db, { kind: "hash_batch", notBefore: 9_000 });
    expect(jobQueueSnapshot(t.db).nextDueAt).toBe(9_000);
  });
});

describe("stage progress: real totals only", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("measures the scan against the device's reported library size", () => {
    // The device says 2867 photos; only 161 have been enumerated so far. That
    // 2867 is known from the album listing before a single asset is read, so
    // the denominator is fixed from the first frame.
    t.db.run(
      sql`INSERT INTO local_album (id, title, asset_count, modified_at, backup_selection)
          VALUES ('__library__', 'All Photos', 2867, 0, 1)`
    );
    for (let i = 0; i < 161; i += 1) insertLocalAsset(t.db, { id: `a${i}` });

    expect(scanCounts(t.db)).toEqual({ scanned: 161, total: 2867 });
  });

  it("never lets the scan denominator be smaller than what was scanned", () => {
    t.db.run(
      sql`INSERT INTO local_album (id, title, asset_count, modified_at, backup_selection)
          VALUES ('__library__', 'All Photos', 5, 0, 1)`
    );
    for (let i = 0; i < 9; i += 1) insertLocalAsset(t.db, { id: `a${i}` });
    // A progress bar must never overshoot; the larger of the two wins.
    expect(scanCounts(t.db)).toEqual({ scanned: 9, total: 9 });
  });

  it("counts hashing over images only, and reports unreadable files separately", () => {
    for (let i = 0; i < 5; i += 1) insertLocalAsset(t.db, { id: `img${i}`, hash: i < 3 ? `h${i}` : null });
    // Videos are hashed lazily at upload time, so counting them would put a
    // denominator on screen the pass never intends to reach.
    insertLocalAsset(t.db, { id: "vid", type: "video" });
    // One image is permanently unreadable: attempted, no hash. Without calling
    // it out, "3 of 5" would sit there forever with no explanation.
    t.db.run(sql`UPDATE local_asset SET hashed_at = 1 WHERE id = 'img4'`);

    expect(hashCounts(t.db)).toEqual({ hashed: 3, total: 5, unreadable: 1 });
  });

  it("counts thumb coverage over the visible timeline", () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "r0", imageHash: "h0" }),
      remotePhoto({ id: "r1", imageHash: "h1" }),
      remotePhoto({ id: "r2", imageHash: "h2" }),
    ]);
    t.db.run(
      sql`INSERT INTO thumb_cache (photo_id, file_path, size_bytes, last_used) VALUES ('r0', '/x', 10, 1)`
    );
    expect(thumbCounts(t.db)).toEqual({ cached: 1, total: 3 });
  });

  it("reports every stage with its own denominator and queue depth", () => {
    t.db.run(
      sql`INSERT INTO local_album (id, title, asset_count, modified_at, backup_selection)
          VALUES ('__library__', 'All Photos', 100, 0, 1)`
    );
    for (let i = 0; i < 20; i += 1) insertLocalAsset(t.db, { id: `a${i}`, hash: i < 8 ? `h${i}` : null });
    enqueueJobs(t.db, [
      { kind: "device_scan", payload: { chunk: 1 } },
      { kind: "hash_batch" },
    ]);
    claimNextJob(t.db, 1_000); // device_scan is running

    const stages = syncStages(t.db);
    const byStage = Object.fromEntries(stages.map((s) => [s.stage, s]));

    expect(byStage.scan).toMatchObject({ done: 20, total: 100, queued: 1, active: true });
    expect(byStage.hash).toMatchObject({ done: 8, total: 20, queued: 1, active: false });
    // Each stage keeps its own fraction — the failure mode was collapsing two
    // pipelines into one ratio whose denominator moved.
    expect(byStage.scan.total).not.toBe(byStage.hash.total);
  });
});

describe("backupState with the job queue wired in", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    setBackupConfig(t.db, { enabled: true });
  });
  afterEach(() => t.close());

  function stateOf() {
    return backupState(t.db, {
      config: getBackupConfig(t.db),
      access: "all",
      jobs: jobQueueSnapshot(t.db),
    });
  }

  it("reports the scanning stage against the device total while a scan job is live", () => {
    t.db.run(
      sql`INSERT INTO local_album (id, title, asset_count, modified_at, backup_selection)
          VALUES ('__library__', 'All Photos', 2867, 0, 1)`
    );
    for (let i = 0; i < 161; i += 1) insertLocalAsset(t.db, { id: `a${i}` });
    t.db.run(sql`INSERT INTO local_album_asset (album_id, asset_id) SELECT '__library__', id FROM local_asset`);
    enqueueJob(t.db, { kind: "device_scan", payload: { chunk: 0 } });

    // The exact number the maintainer saw — but now with the honest total, and
    // named as the stage that is actually running.
    expect(stateOf().stage).toEqual({ kind: "scanning", done: 161, total: 2867 });
  });

  it("falls through to hashing once the scan has finished", () => {
    insertLocalAsset(t.db, { id: "a0", hash: "h0" });
    insertLocalAsset(t.db, { id: "a1" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a0", "a1"] });
    // No device_scan job live ⇒ scanning is over.
    enqueueJob(t.db, { kind: "hash_batch" });
    expect(stateOf().stage).toEqual({ kind: "hashing", done: 1, total: 2 });
  });

  it("blames a job the queue has given up on, in its own words", () => {
    insertLocalAsset(t.db, { id: "a0", hash: "h0" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a0"] });
    enqueueJob(t.db, { kind: "hash_batch" });
    const job = claimNextJob(t.db, 1_000)!;
    failJob(t.db, { id: job.id, attempts: MAX_JOB_ATTEMPTS }, "media library denied", 1_000);

    expect(stateOf().blocker).toEqual({
      kind: "job_failed",
      count: 1,
      message: "hash_batch: media library denied",
    });
  });

  it("still works with no queue snapshot at all (before the first drain)", () => {
    insertLocalAsset(t.db, { id: "a0", hash: "h0" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a0"] });
    const state = backupState(t.db, { config: getBackupConfig(t.db), access: "all" });
    expect(state.stage.kind).toBe("up_to_date");
    expect(state.scan.scanned).toBe(1);
  });
});
