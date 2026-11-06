import type { Job } from "@librephotos/api-client";
import { Badge, Stack, Text, Tooltip } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { jobOutcome, type JobOutcome } from "./jobStatus";

type ChipJob = Pick<Job, "finished" | "failed" | "cancelled" | "started_at" | "result" | "error"> &
  Partial<Pick<Job, "progress_current" | "progress_target">>;

/**
 * Colour only where it says something: a finished job's chip is neutral, a running one primary,
 * some failed items yellow and a failure red.
 */
const CHIP_COLOR: Record<JobOutcome, string> = {
  queued: "gray",
  running: "blue",
  completed: "gray",
  partial_failure: "yellow",
  failed: "red",
  cancelled: "gray",
};

/** A job's state as a small chip ("Completed", "2 failed"); a failure's chip shows its error on hover. */
export function JobStatusChip({ job }: Readonly<{ job: ChipJob }>) {
  const { t } = useTranslation();
  const outcome = jobOutcome(job);
  const errorCount = job.result?.error_count != null ? Number(job.result.error_count) : 0;
  const errorMessage = job.result?.error ? String(job.result.error) : job.error ? String(job.error) : null;
  const total = job.progress_target || job.progress_current || 0;

  const labels: Record<JobOutcome, string> = {
    queued: t("joblist.queued"),
    running: t("topmenu.running"),
    completed: t("joblist.completed"),
    partial_failure: t("joblist.failedcount", { count: errorCount }),
    failed: t("joblist.failed"),
    cancelled: t("joblist.cancelled"),
  };
  const chip = (
    <Badge size="sm" variant="light" color={CHIP_COLOR[outcome]} tt="none" fw={500}>
      {labels[outcome]}
    </Badge>
  );

  if (outcome !== "failed" && outcome !== "partial_failure") {
    return chip;
  }
  return (
    <Tooltip
      multiline
      w={300}
      label={
        <Stack gap={4}>
          {outcome === "partial_failure" && (
            <Text size="xs" fw={600}>
              {t("joblist.partialfailure", { errorCount, total })}
            </Text>
          )}
          {errorMessage && <Text size="xs">{errorMessage}</Text>}
        </Stack>
      }
    >
      {chip}
    </Tooltip>
  );
}
