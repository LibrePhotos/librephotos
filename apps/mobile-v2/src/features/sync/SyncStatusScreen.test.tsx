import { waitFor } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { SyncStatusScreen } from "./SyncStatusScreen";
import { renderWithDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { insertLocalAsset, remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";
import { upsertSyncState } from "@/db/queries/sync-state";
import { appendSyncLog } from "@/db/queries/sync-log";
import { enqueueOutbox } from "@/mutations/outbox";
import { claimNextJob, enqueueJob, enqueueJobs, failJob } from "@/sync/jobs/queue";
import { MAX_JOB_ATTEMPTS } from "@/sync/jobs/types";
import { useAuthStore } from "@/stores/auth";
import { useSyncStore } from "@/stores/sync";

describe("SyncStatusScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    useAuthStore.setState({ userId: 1 });
    useSyncStore.setState({ running: false, progress: null, lastError: null });
  });
  afterEach(() => t.close());

  it("renders the per-entity table + counts + log from fixture state", async () => {
    seedRemotePhotos(t.db, [
      remotePhoto({ id: "a", imageHash: "hashA", timestamp: Date.UTC(2024, 0, 2) }),
      remotePhoto({ id: "b", imageHash: "hashB", timestamp: Date.UTC(2024, 0, 3) }),
    ]);
    upsertSyncState(t.db, "photo", {
      status: "done",
      last_full_sync: Date.UTC(2024, 0, 4),
      cursor_modified: Date.UTC(2024, 0, 3),
      progress_current: 2,
      progress_total: 2,
    });
    appendSyncLog(t.db, { op: "seed", entity: "photo", applied: 2, message: "1 page(s)" });

    const { getByTestId, queryByTestId } = renderWithDb(<SyncStatusScreen />, t.db);

    await waitFor(() => {
      expect(getByTestId("sync-status-title")).toBeTruthy();
      // Photo entity row shows its local count (2).
      const row = getByTestId("sync-entity-photo");
      expect(row).toBeTruthy();
      // Log is non-empty.
      expect(queryByTestId("sync-log-empty")).toBeNull();
      // Action buttons are present.
      expect(getByTestId("sync-repair-button")).toBeTruthy();
      expect(getByTestId("sync-now-button")).toBeTruthy();
    });
  });

  it("shows the outbox pending badge when mutations are queued", async () => {
    enqueueOutbox(t.db, "favorite", { imageHashes: ["hashA"], favorite: true });
    enqueueOutbox(t.db, "hide", { imageHashes: ["hashB"], hidden: true });
    const { getByTestId } = renderWithDb(<SyncStatusScreen />, t.db);
    await waitFor(() => {
      expect(getByTestId("outbox-badge")).toBeTruthy();
      expect(getByTestId("outbox-badge").props.children.props.children).toBe(2);
    });
  });

  it("reports all-synced when the outbox is empty", async () => {
    const { getByTestId, queryByTestId } = renderWithDb(<SyncStatusScreen />, t.db);
    await waitFor(() => {
      expect(queryByTestId("outbox-badge")).toBeNull();
      expect(getByTestId("outbox-summary")).toBeTruthy();
    });
  });

  it("shows the live progress bar while a run is in flight", async () => {
    useSyncStore.setState({
      running: true,
      progress: { entity: "photo", current: 5, total: 10, phase: "seed" },
    });
    const { getByTestId } = renderWithDb(<SyncStatusScreen />, t.db);
    await waitFor(() => expect(getByTestId("sync-progress-bar")).toBeTruthy());
  });
});

/**
 * The three questions the device run could not answer. Each test below is one
 * of them, rendered.
 */
describe("SyncStatusScreen: work queue", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    useAuthStore.setState({ userId: 1 });
    useSyncStore.setState({ running: false, progress: null, lastError: null });
  });
  afterEach(() => t.close());

  it("says the queue is idle when there is nothing to do", async () => {
    const { getByTestId } = renderWithDb(<SyncStatusScreen />, t.db);
    await waitFor(() => {
      expect(getByTestId("sync-queue-depth").props.children).toContain("up to date");
    });
  });

  it("names the job in flight and the depth per kind", async () => {
    enqueueJobs(t.db, [
      { kind: "device_scan", payload: { chunk: 0 } },
      { kind: "upload_asset", payload: { assetId: "a1" } },
      { kind: "upload_asset", payload: { assetId: "a2" } },
    ]);
    claimNextJob(t.db, 1_000); // device_scan is now running

    const { getByTestId } = renderWithDb(<SyncStatusScreen />, t.db);
    await waitFor(() => {
      // "which stage is running"
      expect(getByTestId("sync-queue-inflight-device_scan")).toBeTruthy();
      // "how deep is the backlog"
      expect(getByTestId("sync-queue-kind-upload_asset")).toBeTruthy();
    });
  });

  it("shows each failure with its own reason, and offers a retry", async () => {
    enqueueJob(t.db, { kind: "hash_batch" });
    const job = claimNextJob(t.db, 1_000)!;
    failJob(t.db, { id: job.id, attempts: MAX_JOB_ATTEMPTS }, "media library denied", 1_000);

    const { getByTestId } = renderWithDb(<SyncStatusScreen />, t.db);
    await waitFor(() => {
      // "what is blocking it" — in the queue's own words, not a guess.
      const failure = getByTestId(`sync-queue-failure-${job.id}`);
      expect(failure.props.children.join("")).toContain("media library denied");
      expect(getByTestId("sync-queue-retry-button")).toBeTruthy();
    });
  });

  it("renders every pipeline stage against a fixed total", async () => {
    // 2867 in the library, 161 enumerated — the exact numbers from the device
    // run. The old UI showed "0/161"; the denominator here must be 2867.
    t.db.run(
      sql`INSERT INTO local_album (id, title, asset_count, modified_at, backup_selection)
          VALUES ('__library__', 'All Photos', 2867, 0, 1)`
    );
    for (let i = 0; i < 161; i += 1) insertLocalAsset(t.db, { id: `a${i}` });

    const { getByTestId } = renderWithDb(<SyncStatusScreen />, t.db);
    await waitFor(() => {
      expect(getByTestId("sync-stage-progress-scan").props.children).toBe("161 of 2867");
      // Hashing is its own line with its own denominator, never folded into a
      // single ratio whose bottom half moves as the stage discovers work.
      expect(getByTestId("sync-stage-progress-hash").props.children).toBe("0 of 161");
      expect(getByTestId("sync-stage-progress-upload")).toBeTruthy();
    });
  });
});
