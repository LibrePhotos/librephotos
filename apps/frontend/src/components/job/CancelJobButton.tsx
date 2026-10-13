import type { Job } from "@librephotos/api-client";
import { Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";
import { CancelJobModal } from "./CancelJobModal";

export function CancelJobButton({ job }: Readonly<{ job: Job }>) {
  const { t } = useTranslation();
  const [confirmOpened, { open, close }] = useDisclosure(false);

  if (job.finished || job.cancelled) {
    return null;
  }

  return (
    <>
      <Button onClick={open} color="red" variant="outline" size="xs">
        {t("joblist.cancel")}
      </Button>
      <CancelJobModal opened={confirmOpened} onClose={close} job={job} />
    </>
  );
}
