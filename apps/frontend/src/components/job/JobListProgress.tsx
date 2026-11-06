import type { Job } from "@librephotos/api-client";
import { Text, Tooltip } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { jobDurationLabel } from "./JobDuration";
import { JobProgress } from "./JobProgress";
import { jobOutcome } from "./jobStatus";

/**
 * The job list's progress cell: the bar only while a job waits or runs, so a page of finished jobs
 * is not a column of empty tracks; a finished job shows how long it took ("482 ms") instead, with the
 * number of items on hover.
 */
export function JobListProgress({ job }: Readonly<{ job: Job }>): React.JSX.Element | null {
  const { t } = useTranslation();
  const outcome = jobOutcome(job);
  if (outcome === "queued" || outcome === "running") {
    return (
      <JobProgress
        target={job.progress_target}
        current={job.progress_current}
        failed={job.failed}
        cancelled={job.cancelled}
        finished={job.finished}
        result={job.result}
        progressStep={job.progress_step}
      />
    );
  }
  const duration = jobDurationLabel(job, t);
  if (!duration) {
    return null;
  }
  return (
    <Tooltip label={t("joblist.itemsprocessed", { count: job.progress_current })}>
      <Text component="span" size="sm" c="dimmed" data-duration>
        {duration}
      </Text>
    </Tooltip>
  );
}
