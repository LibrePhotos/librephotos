import { Button } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

import type { Job } from "../../api_client/admin-jobs-schema";
import { useDeleteJobMutation } from "../../api_client/tanstack-api";

export function DeleteJobButton({ job }: Readonly<{ job: Job }>) {
  const { t } = useTranslation();
  const { mutate: deleteJob, isPending } = useDeleteJobMutation();

  return (
    <Button 
      onClick={() => deleteJob(job.id)} 
      color="red" 
      variant="outline" 
      size="xs"
      loading={isPending}
    >
      {t("adminarea.remove")}
    </Button>
  );
}
