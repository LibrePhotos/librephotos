import type { Job } from "@librephotos/api-client";
import { Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDeleteJobMutation } from "../../api_client/jobs/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";
import { jobTypeLabel } from "./jobTypeLabel";

// Job types whose next incremental run starts from the newest successful run of the same type
// (LongRunningJob.baselines in the backend): a scan rereads files changed since it, face scans
// and geolocation redo photos added since it. Tagging and OCR skip photos they already did.
const SCAN_PHOTOS = 1;
const PHOTO_BASELINE_TYPES: ReadonlySet<number> = new Set([7, 11]);

type RemovableJob = Pick<
  Job,
  | "job_type"
  | "job_type_str"
  | "finished"
  | "started_at"
  | "cancelled"
  | "failed"
  | "progress_current"
  | "progress_target"
  | "result"
>;

/**
 * Whether the job went through all of its work, as LongRunningJob.baselines asks of a baseline:
 * not cancelled, and either not failed or failed only for item errors after reaching its target.
 */
function ranToTheEnd(job: RemovableJob): boolean {
  const target = job.progress_target ?? 0;
  const reachedTarget = target > 0 && (job.progress_current ?? 0) >= target;
  return job.finished && job.started_at !== null && !job.cancelled && (!job.failed || reachedTarget);
}

/** The baseline message for `job`'s type, or null when no later run starts from it. */
function baselineMessage(job: RemovableJob, t: TFunction): string | null {
  // Only a scan of the whole scan directory counts, not a file-list or Nextcloud scan.
  if (job.job_type === SCAN_PHOTOS) {
    return job.result?.library_scan === true ? t("confirmdialog.removejob.scanbaseline") : null;
  }
  if (PHOTO_BASELINE_TYPES.has(job.job_type)) {
    return t("confirmdialog.removejob.photobaseline", { job: jobTypeLabel(job, t) });
  }
  return null;
}

/**
 * What removing the job loses. A complete run is the baseline of the next incremental run of
 * its type, so removing the newest one makes that run redo work (#1104).
 */
export function removeJobMessage(job: RemovableJob, t: TFunction): string {
  if (!job.finished) {
    return t("confirmdialog.removejob.unfinished");
  }
  return (ranToTheEnd(job) && baselineMessage(job, t)) || t("confirmdialog.removejob.plain");
}

export function DeleteJobButton({ job }: Readonly<{ job: Job }>) {
  const { t } = useTranslation();
  const { mutate: deleteJob, isPending } = useDeleteJobMutation();
  const [confirmOpened, { open, close }] = useDisclosure(false);

  return (
    <>
      <Button onClick={open} color="red" variant="outline" size="xs">
        {t("adminarea.remove")}
      </Button>
      <ConfirmModal
        opened={confirmOpened}
        onClose={close}
        onConfirm={() => deleteJob(job.id, { onSuccess: close })}
        loading={isPending}
        irreversible
        title={t("confirmdialog.removejob.title")}
        message={removeJobMessage(job, t)}
        confirmLabel={t("confirmdialog.removejob.confirm")}
      />
    </>
  );
}
