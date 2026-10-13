import type { JobDetail } from "@librephotos/api-client";
import React from "react";
import { useTranslation } from "react-i18next";
import { useCancelJobMutation } from "../../api_client/jobs/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";
import { formatJobDuration } from "./JobDuration";
import { jobTypeLabel } from "./jobTypeLabel";

/** What the dialog needs of a job; a row of the job list and the worker's running job both have it. */
type CancellableJob = Pick<JobDetail, "id" | "job_type" | "job_type_str" | "started_at">;

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  job: CancellableJob;
}>;

/**
 * Asks before cancelling a job (#2223): one misclick used to stop a scan that had been
 * running for hours. Closes once the server has cancelled the job; on an error the hook
 * reports it and the dialog stays open to try again.
 */
export function CancelJobModal({ opened, onClose, job }: Props) {
  const { t } = useTranslation();
  const { mutate: cancelJob, isPending } = useCancelJobMutation();
  const name = jobTypeLabel(job, t);

  return (
    <ConfirmModal
      opened={opened}
      onClose={onClose}
      onConfirm={() => cancelJob(job.id, { onSuccess: onClose })}
      loading={isPending}
      title={t("confirmdialog.canceljob.title")}
      message={
        job.started_at
          ? t("confirmdialog.canceljob.running", { job: name, duration: formatJobDuration(job.started_at) })
          : t("confirmdialog.canceljob.queued", { job: name })
      }
      confirmLabel={t("confirmdialog.canceljob.confirm")}
      // "Cancel" next to "Cancel job" would be ambiguous.
      cancelLabel={job.started_at ? t("confirmdialog.canceljob.keeprunning") : t("confirmdialog.canceljob.keepqueued")}
    />
  );
}
