import { Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAllJobsQuery, useRemoveJobsMutation } from "../../api_client/jobs/hooks";
import { notification } from "../../service/notifications";
import { DisabledReason } from "../common/DisabledReason";
import { ConfirmModal } from "../modals/ConfirmModal";
import { removableFinishedJobs } from "./removableJobs";

/**
 * "Remove finished jobs" on My Jobs (#2908): the records of the user's finished jobs, one confirm
 * for all of them. The jobs later runs build on stay (see removableFinishedJobs).
 */
export function RemoveFinishedJobsButton() {
  const { t } = useTranslation();
  const { data: jobs, isFetching } = useAllJobsQuery(true);
  const { mutate: removeJobs, isPending } = useRemoveJobsMutation();
  const [confirmOpened, { open, close }] = useDisclosure(false);
  const removable = useMemo(() => (jobs ? removableFinishedJobs(jobs) : []), [jobs]);

  return (
    <>
      <DisabledReason reason={jobs !== undefined && removable.length === 0 && t("joblist.nothingtoremove")}>
        <Button onClick={open} color="red" variant="outline" size="xs" loading={jobs === undefined && isFetching}>
          {t("joblist.removefinished")}
        </Button>
      </DisabledReason>
      <ConfirmModal
        opened={confirmOpened}
        onClose={close}
        onConfirm={() =>
          removeJobs(
            removable.map(job => job.id),
            {
              onSuccess: removed => {
                close();
                notification.success(t("joblist.finishedremoved", { count: removed }));
              },
            }
          )
        }
        loading={isPending}
        irreversible
        title={t("confirmdialog.removefinishedjobs.title")}
        message={t("confirmdialog.removefinishedjobs.message", { count: removable.length })}
        confirmLabel={t("confirmdialog.removefinishedjobs.confirm")}
      />
    </>
  );
}
