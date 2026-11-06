import type { Job } from "@librephotos/api-client";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDeleteJobMutation } from "../../api_client/jobs/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";
import { removeJobMessage } from "./removeJobMessage";

type Props = Readonly<{
  job: Job;
  opened: boolean;
  onClose: () => void;
  /** Called once the server has removed the job, e.g. to leave the job's own page (#2213). */
  onDeleted?: () => void;
}>;

/**
 * "Remove this job?": what removing the entry loses (it never stops a running job), then the
 * removal. Opened by the detail page's Remove button and the list's ⋮ menu.
 */
export function RemoveJobModal({ job, opened, onClose, onDeleted }: Props) {
  const { t } = useTranslation();
  const { mutate: deleteJob, isPending } = useDeleteJobMutation();

  return (
    <ConfirmModal
      opened={opened}
      onClose={onClose}
      onConfirm={() =>
        deleteJob(job.id, {
          onSuccess: () => {
            onClose();
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
  );
}
