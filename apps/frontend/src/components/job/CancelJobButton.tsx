import { Button } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useCancelJobMutation } from "../../api_client/jobs/hooks";
import type { Job } from "../../api_client/jobs/types";

export function CancelJobButton({ job }: Readonly<{ job: Job }>) {
  const { t } = useTranslation();
  const { mutate: cancelJob, isPending } = useCancelJobMutation();

  if (job.finished || job.cancelled) {
    return null;
  }

  return (
    <Button onClick={() => cancelJob(job.id)} color="red" variant="outline" size="xs" loading={isPending}>
      {t("joblist.cancel")}
    </Button>
  );
}
