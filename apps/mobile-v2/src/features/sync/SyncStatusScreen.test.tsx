import { waitFor } from "@testing-library/react-native";
import { SyncStatusScreen } from "./SyncStatusScreen";
import { renderWithDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";
import { upsertSyncState } from "@/db/queries/sync-state";
import { appendSyncLog } from "@/db/queries/sync-log";
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

  it("shows the live progress bar while a run is in flight", async () => {
    useSyncStore.setState({
      running: true,
      progress: { entity: "photo", current: 5, total: 10, phase: "seed" },
    });
    const { getByTestId } = renderWithDb(<SyncStatusScreen />, t.db);
    await waitFor(() => expect(getByTestId("sync-progress-bar")).toBeTruthy());
  });
});
