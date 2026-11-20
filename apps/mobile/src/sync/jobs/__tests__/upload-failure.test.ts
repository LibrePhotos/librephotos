/**
 * @jest-environment node
 *
 * The silent-success regression.
 *
 * A device export showed `upload_asset` jobs running for seconds each and
 * settling as **done** with `applied=0`, while the server answered 403 to every
 * `/api/upload/complete/`. Nothing reached the server, the queue believed it had
 * succeeded, and the Sync screen had nothing to raise — the failure was invisible
 * for as long as it took someone to read a Django access log.
 *
 * The rule these tests pin down: a completion that does not return 2xx makes the
 * *job* fail. Failure is what buys a retry, a backoff, and a visible blocker.
 */
import { sql } from "drizzle-orm";
import { createTestDb, insertLocalAlbum, insertLocalAsset, type TestDb } from "@librephotos/local-db/testing";
import { enqueueBackups, type SyncLogEntry } from "@librephotos/local-db";
import { runUploadItem } from "@/sync/upload/worker";
import type {
  UploadCompleteInput,
  UploadCompleteResult,
  UploadFileInput,
  UploadResult,
  UploadTransport,
} from "@/sync/upload/transport";
import { FakeSource, emptyStore } from "@/sync/__tests__/fake-source";
import { createJobHandlers } from "../handlers";
import { enqueueJob } from "../queue";
import { runWorker, resetBootReclaimForTests } from "../worker";
import { defined } from "@/test/defined";

const USER_ID = 7;
const fastYield = async () => Promise.resolve();

/** A transport whose bytes land but whose completion is rejected by the server. */
class RejectingCompleteTransport implements UploadTransport {
  completeStatus: number;
  completeDetail: string;
  uploads: UploadFileInput[] = [];
  completes: UploadCompleteInput[] = [];
  constructor(status = 403, detail = "Authentication credentials were not provided") {
    this.completeStatus = status;
    this.completeDetail = detail;
  }
  async exists(): Promise<boolean> {
    return false;
  }
  async uploadFile(input: UploadFileInput): Promise<UploadResult> {
    this.uploads.push(input);
    return { uploadId: `up-${input.assetId}`, md5: "uploaded-md5" };
  }
  async complete(input: UploadCompleteInput): Promise<UploadCompleteResult> {
    this.completes.push(input);
    throw new Error(`complete failed: HTTP ${this.completeStatus} — ${this.completeDetail}`);
  }
}

async function seedQueued(t: TestDb, id: string, hash: string): Promise<void> {
  await insertLocalAsset(t.db, { id, hash, uri: `file:///${id}.jpg` });
  await insertLocalAlbum(t.db, { id: `alb-${id}`, backupSelection: 1, assetIds: [id] });
  await enqueueBackups(t.db);
}

async function jobRow(t: TestDb, id: number): Promise<{ state: string; last_error: string | null }> {
  return await t.db.get<{ state: string; last_error: string | null }>(
    sql`SELECT state, last_error FROM job_queue WHERE id = ${id}`
  );
}

describe("upload_asset job failure propagation", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
    resetBootReclaimForTests();
  });
  afterEach(() => t.close());

  it("marks the job failed — not done — when the completion is rejected", async () => {
    await seedQueued(t, "a1", "h1");
    const transport = new RejectingCompleteTransport(403);
    const logs: SyncLogEntry[] = [];

    const handlers = createJobHandlers({
      source: new FakeSource(emptyStore()),
      uploadAsset: (ctx, assetId) =>
        runUploadItem(ctx.db, assetId, { userId: USER_ID, transport }),
    });
    const id = defined(await enqueueJob(t.db, { kind: "upload_asset", payload: { assetId: "a1" } }));

    const stats = await runWorker(t.db, {
      handlers,
      yield: fastYield,
      log: (e) => logs.push(e),
    });

    // The bytes were offered and the completion was attempted...
    expect(transport.completes).toHaveLength(1);
    // ...and the job records that as a failure, so it will be retried.
    expect(stats.succeeded).toBe(0);
    expect(stats.failed).toBe(1);
    expect(stats.applied).toBe(0);

    const row = await jobRow(t, id);
    expect(row.state).not.toBe("done");
    expect(row.state).toBe("pending"); // scheduled for a backed-off retry
    // The server's own words survive into the log, which is what makes the next
    // occurrence a one-line diagnosis instead of a Django access-log archaeology.
    expect(row.last_error).toContain("HTTP 403");
    expect(logs.some((e) => e.level !== "info" && String(e.message).includes("403"))).toBe(true);
  });

  it("leaves the upload queue item failed rather than done", async () => {
    await seedQueued(t, "a1", "h1");
    const transport = new RejectingCompleteTransport(400, "md5 checksum does not match");

    const handlers = createJobHandlers({
      source: new FakeSource(emptyStore()),
      uploadAsset: (ctx, assetId) =>
        runUploadItem(ctx.db, assetId, { userId: USER_ID, transport }),
    });
    await enqueueJob(t.db, { kind: "upload_asset", payload: { assetId: "a1" } });

    await runWorker(t.db, { handlers, yield: fastYield });

    const item = await t.db.get<{ state: string; last_error: string | null }>(
      sql`SELECT state, last_error FROM upload_queue WHERE asset_id = 'a1'`
    );
    expect(item.state).toBe("failed");
    expect(item.last_error).toContain("md5 checksum does not match");
  });

  it("still settles as done when the completion succeeds", async () => {
    await seedQueued(t, "a1", "h1");
    const completes: UploadCompleteInput[] = [];
    const transport: UploadTransport = {
      async exists() {
        return false;
      },
      async uploadFile(input) {
        return { uploadId: `up-${input.assetId}`, md5: "fresh-md5" };
      },
      async complete(input) {
        completes.push(input);
        return { photoId: null };
      },
    };

    const handlers = createJobHandlers({
      source: new FakeSource(emptyStore()),
      uploadAsset: (ctx, assetId) =>
        runUploadItem(ctx.db, assetId, { userId: USER_ID, transport }),
    });
    const id = defined(await enqueueJob(t.db, { kind: "upload_asset", payload: { assetId: "a1" } }));

    const stats = await runWorker(t.db, { handlers, yield: fastYield });

    expect(stats.failed).toBe(0);
    expect(stats.applied).toBe(1);
    expect((await jobRow(t, id)).state).toBe("done");
    // And the checksum is the one measured on the bytes that were sent, not the
    // (possibly stale) hash recorded during the hash pass.
    expect(completes[0].md5).toBe("fresh-md5");
  });
});
