import { Button, Menu, Progress, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useCancelJobMutation } from "../../api_client/jobs/hooks";
import type { JobDetail } from "../../api_client/jobs/types";

// Share of the job done, 0-100, or null when there is nothing to measure yet.
export function jobPercent(job: JobDetail | null): number | null {
  if (!job || job.progress_target <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, (job.progress_current / job.progress_target) * 100));
}

type Props = Readonly<{
  // Null while the worker is busy with a job this user cannot see.
  job: JobDetail | null;
}>;

// The running job, shown at the top of the account menu only while the worker is
// busy. The full job history stays one click away under "My Jobs".
export function WorkerJobMenuSection({ job }: Props) {
  const { t } = useTranslation();
  const { mutate: cancelJob, isPending } = useCancelJobMutation();
  const percent = jobPercent(job);

  return (
    <>
      <Stack gap={6} px="sm" py="xs" data-testid="worker-job-section">
        {job ? (
          <>
            <Text size="sm" fw={500}>
              {t("topmenu.running")} {t(job.job_type_str)}
            </Text>
            <Progress value={percent ?? 0} size="sm" aria-label={t(job.job_type_str)} />
            {job.progress_target > 0 && (
              <Text size="xs" c="dimmed">
                {job.progress_current} / {job.progress_target}
              </Text>
            )}
            {!job.finished && !job.cancelled && (
              <Button
                onClick={() => cancelJob(job.id)}
                color="red"
                variant="subtle"
                size="compact-xs"
                loading={isPending}
                style={{ alignSelf: "flex-start" }}
              >
                {t("joblist.cancel")}
              </Button>
            )}
          </>
        ) : (
          <Text size="sm">{t("topmenu.busy")}</Text>
        )}
      </Stack>
      <Menu.Divider />
    </>
  );
}
