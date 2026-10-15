import type { Job } from "@librephotos/api-client";
import { Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDeleteJobMutation } from "../../api_client/jobs/hooks";
import { DisabledReason } from "../common/DisabledReason";
import { ConfirmModal } from "../modals/ConfirmModal";
import { jobTypeLabel } from "./jobTypeLabel";

// Add Geolocation's next incremental run only covers photos added since its newest complete run
// (LongRunningJob.baselines in the backend). A scan's baseline comes from the server instead
// (is_scan_baseline), and the other jobs pick up what is left to do whatever ran before.
const ADD_GEOLOCATION = 11;

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

/**
 * What removing the job loses. The scan the next incremental scan starts from cannot be removed
 * (see DeleteJobButton), so removing any other scan changes nothing in the library (#1104).
 */
export function removeJobMessage(job: RemovableJob, t: TFunction): string {
  if (!job.finished) {
    return t("confirmdialog.removejob.unfinished");
  }
  if (job.job_type === ADD_GEOLOCATION && ranToTheEnd(job)) {
    return t("confirmdialog.removejob.photobaseline", { job: jobTypeLabel(job, t) });
  }
  return t("confirmdialog.removejob.plain");
}

type DeleteJobButtonProps = Readonly<{
  job: Job;
  /** Called once the server has removed the job, e.g. to leave the job's own page (#2213). */
  onDeleted?: () => void;
}>;

export function DeleteJobButton({ job, onDeleted }: DeleteJobButtonProps) {
  const { t } = useTranslation();
  const { mutate: deleteJob, isPending } = useDeleteJobMutation();
  const [confirmOpened, { open, close }] = useDisclosure(false);

  return (
    <>
      {/* The server refuses it too (409 scan_baseline): without it the next scan rereads every file. */}
      <DisabledReason reason={job.is_scan_baseline === true && t("joblist.scanbaseline")}>
        <Button onClick={open} color="red" variant="outline" size="xs">
          {t("adminarea.remove")}
        </Button>
      </DisabledReason>
      <ConfirmModal
        opened={confirmOpened}
        onClose={close}
        onConfirm={() =>
          deleteJob(job.id, {
            onSuccess: () => {
              close();
              onDeleted?.();
            },
          })
        }
        loading={isPending}
        irreversible
        title={t("confirmdialog.removejob.title")}
        message={removeJobMessage(job, t)}
        confirmLabel={t("confirmdialog.removejob.confirm")}
      />
    </>
  );
}
