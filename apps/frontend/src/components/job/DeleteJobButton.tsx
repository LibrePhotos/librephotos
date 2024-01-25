import { Button } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

import type { Job } from "../../api_client/admin-jobs";
import { useDeleteJobMutation } from "../../api_client/admin-jobs";

export function DeleteJobButton({ job }: Readonly<{ job: Job }>) {
  const { t } = useTranslation();
  const [deleteJob] = useDeleteJobMutation();

  return (
    <Button onClick={() => deleteJob(job.id)} color="red" variant="outline" size="xs">
      {t("adminarea.remove")}
    </Button>
  );
}
