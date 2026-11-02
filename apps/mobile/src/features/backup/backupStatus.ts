/**
 * The live backup state and its one-line headline, shared by the Backup
 * screen, the account screen and the avatar's progress ring.
 */
import { useReactiveQuery } from "@/db/provider";
import { getBackupConfig } from "@/db/queries/backup";
import { getMediaAccess } from "@/sync/device/media-store";
import { jobQueueSnapshot } from "@/sync/jobs/status";
import { backupState, type BackupStage, type BackupState } from "@/sync/upload/status";
import { useSyncStore } from "@/stores/sync";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The job queue tells the screen which stage is actually running, so the
 * headline can name the camera-roll scan instead of silently reporting a hash
 * fraction over a library that has not finished being enumerated.
 */
export function useBackupState(): BackupState {
  const gate = useSyncStore((s) => s.gate);
  return useReactiveQuery<BackupState>(
    (d) =>
      backupState(d, {
        config: getBackupConfig(d),
        access: getMediaAccess(d),
        gate,
        jobs: jobQueueSnapshot(d),
      }),
    [gate]
  );
}

/** The headline: which stage is running, and how far along it is. */
export function stageText(t: Translate, stage: BackupStage): string {
  switch (stage.kind) {
    case "scanning":
      return t("backup.statusScanning", { scanned: stage.done, total: stage.total });
    case "hashing":
      return t("backup.statusHashing", { done: stage.done, total: stage.total });
    case "uploading":
      return t("backup.statusUploading", { done: stage.done, total: stage.total });
    case "waiting":
      return t("backup.statusWaiting", { count: stage.pending });
    case "icloud":
      return t("backup.statusICloud", { count: stage.pending });
    case "processing":
      return t("backup.statusProcessing", { uploaded: stage.uploaded, count: stage.processing });
    case "up_to_date":
      return t("backup.statusUpToDate", { count: stage.total });
    case "idle":
    default:
      return t("backup.statusIdle");
  }
}
