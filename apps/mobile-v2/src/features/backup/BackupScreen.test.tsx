import { fireEvent, waitFor } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import { BackupScreen } from "./BackupScreen";
import { renderWithDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { insertLocalAlbum, insertLocalAsset } from "@/db/__tests__/fixtures";
import { setBackupConfig } from "@/db/queries/backup";
import { setMediaAccess } from "@/sync/device/media-store";
import { useAuthStore } from "@/stores/auth";
import { useSyncStore } from "@/stores/sync";

/** Seed a couple of albums + a queued upload row for the fixture render. */
function seed(t: TestDb): void {
  insertLocalAsset(t.db, { id: "a1", hash: "h1" });
  insertLocalAsset(t.db, { id: "a2", hash: "h2" });
  insertLocalAlbum(t.db, { id: "cam", backupSelection: 1, assetIds: ["a1"] });
  insertLocalAlbum(t.db, { id: "screens", backupSelection: 0, assetIds: ["a2"] });
  t.db.run(
    sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
        VALUES ('a1', 'uploading', 0.5, 0, 1000), ('a2', 'done', 1, 0, 1000)`
  );
}

describe("BackupScreen", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    useAuthStore.setState({ userId: 1 });
    useSyncStore.setState({ running: false, progress: null, lastError: null });
  });
  afterEach(() => t.close());

  it("renders albums, queue, and status from fixture state", async () => {
    seed(t);
    setBackupConfig(t.db, { enabled: true });
    const { getByTestId } = renderWithDb(<BackupScreen />, t.db);

    await waitFor(() => {
      expect(getByTestId("backup-title")).toBeTruthy();
      expect(getByTestId("backup-summary")).toBeTruthy();
      // Album rows + their selection label.
      expect(getByTestId("backup-album-cam")).toBeTruthy();
      expect(getByTestId("backup-album-selection-cam")).toBeTruthy();
      // Queue rows for the uploading + done items.
      expect(getByTestId("backup-queue-a1")).toBeTruthy();
      expect(getByTestId("backup-queue-a2")).toBeTruthy();
    });
  });

  it("shows the iOS limited-access note when access is limited", async () => {
    setMediaAccess(t.db, "limited");
    const { getByTestId } = renderWithDb(<BackupScreen />, t.db);
    await waitFor(() => expect(getByTestId("backup-limited-note")).toBeTruthy());
  });

  it("cycles an album's backup selection on tap (none → selected)", async () => {
    insertLocalAsset(t.db, { id: "a1", hash: "h1" });
    insertLocalAlbum(t.db, { id: "cam", backupSelection: 0, assetIds: ["a1"] });
    const { getByTestId } = renderWithDb(<BackupScreen />, t.db);

    await waitFor(() => expect(getByTestId("backup-album-cam")).toBeTruthy());
    fireEvent.press(getByTestId("backup-album-cam"));

    const row = t.db.get(sql`SELECT backup_selection FROM local_album WHERE id = 'cam'`) as {
      backup_selection: number;
    };
    expect(row.backup_selection).toBe(1); // none(0) → selected(1)
  });

  it("shows an empty-queue message when nothing is queued", async () => {
    const { getByTestId } = renderWithDb(<BackupScreen />, t.db);
    await waitFor(() => expect(getByTestId("backup-queue-empty")).toBeTruthy());
  });
});
