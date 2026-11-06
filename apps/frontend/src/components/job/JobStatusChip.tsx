import type { Job } from "@librephotos/api-client";
import { Badge, Stack, Text, Tooltip } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { jobOutcome, type JobOutcome } from "./jobStatus";
import classes from "./JobStatusChip.module.css";

type ChipJob = Pick<Job, "finished" | "failed" | "cancelled" | "started_at" | "result" | "error"> &
  Partial<Pick<Job, "progress_current" | "progress_target">>;

/**
 * Colour only where it needs attention: a running job's chip is the primary tint and a failure's
 * (all or some items) red. Completed, queued and cancelled are dimmed text, "✓ Completed" with no
 * pill, so a page of finished jobs reads calm (Immich's job cards).
 */
const CHIP_COLOR: Partial<Record<JobOutcome, string | undefined>> = {
  running: undefined,
  partial_failure: "red",
  failed: "red",
};

/** A job's state: dimmed "✓ Completed", or a small chip ("Running", "2 failed"); a failure's shows its error on hover. */
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
  if (!(outcome in CHIP_COLOR)) {
    return (
      <Text component="span" className={classes.quiet}>
        {outcome === "completed" ? <IconCheck size={14} aria-hidden /> : null}
        {labels[outcome]}
      </Text>
    );
  }
  const chip = (
    <Badge variant="light" color={CHIP_COLOR[outcome]} tt="none" className={classes.chip}>
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
