import type { Job } from "@librephotos/api-client";
import { Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";
import { DisabledReason } from "../common/DisabledReason";
import { toolbarLook } from "../common/toolbarLook";
import { RemoveJobModal } from "./RemoveJobModal";

type DeleteJobButtonProps = Readonly<{
  job: Job;
  /** Called once the server has removed the job, e.g. to leave the job's own page (#2213). */
  onDeleted?: () => void;
}>;

/** The job page's Remove button; the job list offers the same in each row's ⋮ menu (JobActionsMenu). */
export function DeleteJobButton({ job, onDeleted }: DeleteJobButtonProps) {
  const { t } = useTranslation();
  const [confirmOpened, { open, close }] = useDisclosure(false);

  return (
    <>
      {/* The server refuses it too (409 scan_baseline): without it the next scan rereads every file. */}
      <DisabledReason reason={job.is_scan_baseline === true && t("joblist.scanbaseline")}>
        <Button onClick={open} {...toolbarLook()} size="xs">
          {t("adminarea.remove")}
        </Button>
      </DisabledReason>
      <RemoveJobModal job={job} opened={confirmOpened} onClose={close} onDeleted={onDeleted} />
    </>
  );
}
