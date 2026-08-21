/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { insertLocalAlbum, insertLocalAsset } from "@/db/__tests__/fixtures";
import { enqueueBackups, nextEligible } from "../queue";
import { runUploadItem, runUploadQueue } from "../worker";
import { evaluateGate, makeUploadGate, type DeviceProbe } from "../gate";
import type { UploadCompleteInput, UploadFileInput, UploadTransport } from "../transport";

/** A scriptable transport recording calls + completion payloads. */
class FakeTransport implements UploadTransport {
  existsSet = new Set<string>();
  failUploadFor = new Set<string>();
  uploads: UploadFileInput[] = [];
  completes: UploadCompleteInput[] = [];
  async exists(hash: string) {
    return this.existsSet.has(hash);
  }
  async uploadFile(input: UploadFileInput) {
    this.uploads.push(input);
    if (this.failUploadFor.has(input.assetId)) throw new Error("network down");
    return { uploadId: `up-${input.assetId}` };
  }
  async complete(input: UploadCompleteInput) {
    this.completes.push(input);
  }
}

function seedQueued(t: TestDb, id: string, hash: string, created = 111, modified = 222): void {
  insertLocalAsset(t.db, { id, hash, createdAt: created });
  t.db.run(sql`UPDATE local_asset SET modified_at = ${modified} WHERE id = ${id}`);
  insertLocalAlbum(t.db, { id: `alb-${id}`, backupSelection: 1, assetIds: [id] });
}
function stateOf(t: TestDb, id: string): string {
  return (t.db.get(sql`SELECT state FROM upload_queue WHERE asset_id = ${id}`) as { state: string }).state;
}
function hashOf(t: TestDb, id: string): string | null {
  return (t.db.get(sql`SELECT hash FROM local_asset WHERE id = ${id}`) as { hash: string | null }).hash;
}

const okProbe: DeviceProbe = { read: async () => ({ onWifi: true, online: true, charging: true }) };

describe("upload worker", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("uploads a pending item and completes with device timestamps (#614)", async () => {
    seedQueued(t, "a1", "h1", 1700000000000, 1700000009999);
    enqueueBackups(t.db);
    const transport = new FakeTransport();

    const res = await runUploadQueue(t.db, { userId: 5, transport, now: () => 1_000 });

    expect(res.uploaded).toBe(1);
    expect(stateOf(t, "a1")).toBe("done");
    // Completion carries the device capture/modify times + raw md5 (userId stripped).
    expect(transport.completes[0]).toMatchObject({
      uploadId: "up-a1",
      md5: "h1", // hash "h1" has no "5" suffix to strip
      userId: 5,
      deviceCreatedAt: 1700000000000,
      deviceModifiedAt: 1700000009999,
    });
  });

  it("strips the userId suffix from the hash for the md5 checksum", async () => {
    seedQueued(t, "a1", "abc123def5"); // md5 "abc123def" + userId "5"
    enqueueBackups(t.db);
    const transport = new FakeTransport();
    await runUploadQueue(t.db, { userId: 5, transport, now: () => 1_000 });
    expect(transport.completes[0].md5).toBe("abc123def");
  });

  it("skips an item the server already has (exists check)", async () => {
    seedQueued(t, "a1", "h1");
    enqueueBackups(t.db);
    const transport = new FakeTransport();
    transport.existsSet.add("h1");

    const res = await runUploadQueue(t.db, { userId: 1, transport, now: () => 1_000 });
    expect(res.skipped).toBe(1);
    expect(res.uploaded).toBe(0);
    expect(transport.uploads).toHaveLength(0);
    expect(stateOf(t, "a1")).toBe("skipped_exists");
  });

  it("notifies onUploaded so a photos delta can be pulled", async () => {
    seedQueued(t, "a1", "h1");
    enqueueBackups(t.db);
    const uploaded: string[] = [];
    await runUploadQueue(t.db, {
      userId: 1,
      transport: new FakeTransport(),
      now: () => 1_000,
      onUploaded: (id) => uploaded.push(id),
    });
    expect(uploaded).toEqual(["a1"]);
  });

  it("marks a failed upload and applies exponential backoff", async () => {
    seedQueued(t, "a1", "h1");
    enqueueBackups(t.db);
    const transport = new FakeTransport();
    transport.failUploadFor.add("a1");

    const res = await runUploadQueue(t.db, { userId: 1, transport, now: () => 1_000, backoffBase: 100 });
    expect(res.failed).toBe(1);
    const row = t.db.get(
      sql`SELECT state, attempts, next_attempt_at, last_error FROM upload_queue WHERE asset_id = 'a1'`
    ) as { state: string; attempts: number; next_attempt_at: number; last_error: string };
    expect(row.state).toBe("failed");
    expect(row.attempts).toBe(1);
    expect(row.next_attempt_at).toBe(1_000 + 100 * 2); // base * 2^attempts
    expect(row.last_error).toContain("network down");
  });

  it("stops immediately when the wifi/charging gate blocks", async () => {
    seedQueued(t, "a1", "h1");
    enqueueBackups(t.db);
    const transport = new FakeTransport();
    const offWifi: DeviceProbe = { read: async () => ({ onWifi: false, online: true, charging: true }) };
    const gate = makeUploadGate({ wifiOnly: true, chargingOnly: false }, offWifi);

    const res = await runUploadQueue(t.db, { userId: 1, transport, gate, now: () => 1_000 });
    expect(res.stoppedReason).toBe("gated");
    expect(res.gateReason).toBe("wifi_required");
    expect(transport.uploads).toHaveLength(0);
    expect(stateOf(t, "a1")).toBe("pending");
  });

  it("honours the per-run item budget", async () => {
    seedQueued(t, "a1", "h1");
    seedQueued(t, "a2", "h2");
    seedQueued(t, "a3", "h3");
    enqueueBackups(t.db);
    const res = await runUploadQueue(t.db, {
      userId: 1,
      transport: new FakeTransport(),
      gate: makeUploadGate({ wifiOnly: false, chargingOnly: false }, okProbe),
      maxItems: 2,
      now: () => 1_000,
    });
    expect(res.uploaded).toBe(2);
    expect(res.stoppedReason).toBe("budget");
  });
});

/* ---------------------------------------------------------------------- *
 * iCloud-only assets: one download, shared between hashing and uploading
 * ---------------------------------------------------------------------- */

/** Records every fetch, so "downloaded twice" is a failing assertion. */
function fakeMaterializer(md5 = "cloud-md5") {
  const calls: string[] = [];
  return {
    calls,
    fn: async (a: { id: string }) => {
      calls.push(a.id);
      return { uri: `file:///tmp/${a.id}.jpg`, md5 };
    },
  };
}

/** A selected asset the hash pass parked: no hash, bytes still in iCloud. */
function seedDeferred(t: TestDb, id: string): void {
  insertLocalAsset(t.db, { id, hash: null, hashState: "icloud" });
  insertLocalAlbum(t.db, { id: `alb-${id}`, backupSelection: 1, assetIds: [id] });
}

describe("upload worker — iCloud-deferred assets", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("fetches the original ONCE and uses those bytes for hash, dedupe and upload", async () => {
    seedDeferred(t, "cloud");
    expect(enqueueBackups(t.db)).toBe(1); // unhashed, but queued: it is selected
    const transport = new FakeTransport();
    const mat = fakeMaterializer();

    const res = await runUploadItem(t.db, "cloud", {
      userId: 7,
      transport,
      materialize: mat.fn,
      now: () => 1_000,
    });

    expect(res.uploaded).toBe(true);
    // One download, not one to hash and another to upload.
    expect(mat.calls).toEqual(["cloud"]);
    // The hash is persisted, in LibrePhotos' md5+userId form, and the parking
    // is cleared — a later run must not re-download this.
    expect(
      (t.db.get(sql`SELECT hash, hash_state FROM local_asset WHERE id = 'cloud'`) as {
        hash: string;
        hash_state: string | null;
      })
    ).toEqual({ hash: "cloud-md57", hash_state: null });
    // The upload reads the already-materialised file, and carries the md5 the
    // fetch measured so the transport need not read the same bytes again.
    expect(transport.uploads[0]).toMatchObject({ uri: "file:///tmp/cloud.jpg", md5: "cloud-md5" });
    expect(transport.completes[0]).toMatchObject({ md5: "cloud-md5", userId: 7 });
  });

  it("still runs the exists check — with the hash it just learned", async () => {
    seedDeferred(t, "cloud");
    enqueueBackups(t.db);
    const transport = new FakeTransport();
    transport.existsSet.add("cloud-md57"); // the server already has these bytes
    const mat = fakeMaterializer();

    const res = await runUploadItem(t.db, "cloud", {
      userId: 7,
      transport,
      materialize: mat.fn,
      now: () => 1_000,
    });

    expect(res.skipped).toBe(true);
    expect(transport.uploads).toHaveLength(0);
    expect(stateOf(t, "cloud")).toBe("skipped_exists");
    // The download could not be avoided (no hash means no dedupe key), but the
    // hash it produced is kept so nothing repeats the trip.
    expect(hashOf(t, "cloud")).toBe("cloud-md57");
  });

  it("does not re-download on the next run — the stored hash takes over", async () => {
    seedDeferred(t, "cloud");
    enqueueBackups(t.db);
    const mat = fakeMaterializer();
    await runUploadItem(t.db, "cloud", {
      userId: 7,
      transport: new FakeTransport(),
      materialize: mat.fn,
      now: () => 1_000,
    });

    // Requeue the same asset (e.g. the server row went away) and run again.
    t.db.run(sql`UPDATE upload_queue SET state = 'pending' WHERE asset_id = 'cloud'`);
    await runUploadItem(t.db, "cloud", {
      userId: 7,
      transport: new FakeTransport(),
      materialize: mat.fn,
      now: () => 2_000,
    });

    expect(mat.calls).toEqual(["cloud"]); // still exactly one fetch, ever
  });

  it("fails with a message a human can read when the download does not come back", async () => {
    seedDeferred(t, "cloud");
    enqueueBackups(t.db);

    const res = await runUploadItem(t.db, "cloud", {
      userId: 7,
      transport: new FakeTransport(),
      materialize: async () => null,
      now: () => 1_000,
      backoffBase: 100,
    });

    expect(res.failed).toBe(true);
    expect(res.error).toContain("iCloud");
    expect(stateOf(t, "cloud")).toBe("failed");
  });

  it("lets a locally-hashed asset overtake an iCloud one in the queue", () => {
    // The iCloud asset is enqueued first, so only an explicit ordering rule
    // keeps a network fetch from parking the serial queue ahead of a photo that
    // is sitting right there on the disk.
    seedDeferred(t, "cloud");
    enqueueBackups(t.db, 1_000);
    seedQueued(t, "local", "h-local");
    enqueueBackups(t.db, 2_000);

    expect(nextEligible(t.db, 3_000)?.asset_id).toBe("local");
  });
});

describe("gate policy", () => {
  it("blocks offline, wifi-required, and charging-required states", () => {
    expect(evaluateGate({ wifiOnly: false, chargingOnly: false }, { onWifi: false, online: false, charging: false }))
      .toEqual({ allowed: false, reason: "offline" });
    expect(evaluateGate({ wifiOnly: true, chargingOnly: false }, { onWifi: false, online: true, charging: true }))
      .toEqual({ allowed: false, reason: "wifi_required" });
    expect(evaluateGate({ wifiOnly: false, chargingOnly: true }, { onWifi: true, online: true, charging: false }))
      .toEqual({ allowed: false, reason: "charging_required" });
    expect(evaluateGate({ wifiOnly: true, chargingOnly: true }, { onWifi: true, online: true, charging: true }))
      .toEqual({ allowed: true });
  });
});
