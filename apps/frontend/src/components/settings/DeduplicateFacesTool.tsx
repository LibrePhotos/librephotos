import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDeduplicateFacesMutation } from "../../api_client/jobs/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";
import { AdminJobTool } from "./AdminJobTool";

// LongRunningJob.JOB_DEDUPLICATE_FACES in the backend.
const DEDUPLICATE_FACES_JOB_TYPE = 31;

/**
 * Admin Tools row that deletes the duplicate faces of every photo (#2030), the job behind
 * `manage.py deduplicate_faces`; before, only the Django admin could. It asks first, because the
 * deleted duplicates cannot be restored.
 */
export function DeduplicateFacesTool({ buttonWidth }: Readonly<{ buttonWidth: number }>) {
  const { t } = useTranslation();
  const { mutate: start, isPending } = useDeduplicateFacesMutation();
  const [confirmOpen, { open, close }] = useDisclosure(false);

  return (
    <>
      <AdminJobTool
        jobType={DEDUPLICATE_FACES_JOB_TYPE}
        title={t("adminarea.deduplicatefaces")}
        explanation={t("adminarea.deduplicatefacesexplanation")}
        buttonWidth={buttonWidth}
        isPending={isPending}
        onStart={open}
      />
      <ConfirmModal
        opened={confirmOpen}
        onClose={close}
        onConfirm={() => start(undefined, { onSettled: close })}
        title={t("adminarea.deduplicatefacesconfirmtitle")}
        message={t("adminarea.deduplicatefacesconfirm")}
        confirmLabel={t("adminarea.deduplicatefacesconfirmbutton")}
        loading={isPending}
      />
    </>
  );
}
