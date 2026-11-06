import type { Job } from "@librephotos/api-client";
import { Loader, Stack, Text, Tooltip } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { jobOutcome, type JobOutcome } from "./jobStatus";
import classes from "./JobStatusChip.module.css";

type ChipJob = Pick<Job, "finished" | "failed" | "cancelled" | "started_at" | "result" | "error"> &
  Partial<Pick<Job, "progress_current" | "progress_target">>;

/**
 * One status badge for every state: a 22px pill with a 6px dot before the label. Only what needs
 * attention is tinted: a running job is the primary tint with a spinner for its dot, a failure (of
 * all or some items) red; completed is a neutral pill with a green dot, queued and cancelled a grey
 * one, so a page of finished jobs reads calm (Immich's job cards).
 */
const TONE: Record<
  JobOutcome,
  { tone: "neutral" | "accent" | "danger"; dot: "success" | "muted" | "danger" | "spinner" }
> = {
  queued: { tone: "neutral", dot: "muted" },
  running: { tone: "accent", dot: "spinner" },
  completed: { tone: "neutral", dot: "success" },
  partial_failure: { tone: "danger", dot: "danger" },
  failed: { tone: "danger", dot: "danger" },
  cancelled: { tone: "neutral", dot: "muted" },
};

/** A job's state as one badge ("Completed", "Running", "2 failed"); a failure's shows its error on hover. */
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
  const { tone, dot } = TONE[outcome];
  const chip = (
    <span className={classes.badge} data-tone={tone} data-dot={dot}>
      {dot === "spinner" ? (
        <Loader size={10} color="currentColor" aria-hidden />
      ) : (
        <span className={classes.dot} aria-hidden />
      )}
      {labels[outcome]}
    </span>
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
