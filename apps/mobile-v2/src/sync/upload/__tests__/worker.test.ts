/**
 * @jest-environment node
 */
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/test-db";
import { insertLocalAlbum, insertLocalAsset } from "@/db/__tests__/fixtures";
import { enqueueBackups } from "../queue";
import { runUploadQueue } from "../worker";
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
