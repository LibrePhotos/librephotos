import { Progress, Text, Tooltip } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { formatCount, formatPercent } from "../../util/formatCount";
import classes from "./JobProgress.module.css";
import { jobOutcome, type JobOutcome } from "./jobStatus";

type IJobProgress = Readonly<{
  target?: number;
  current?: number;
  finished: boolean;
  failed?: boolean;
  cancelled?: boolean;
  result?: Record<string, unknown> | null;
  progressStep?: string | null;
}>;

type Progression = Readonly<{ current: number; target: number; step: string | null }>;

// The direct props, or the job's result where they are missing or 0.
function progression({
  target = 0,
  current = 0,
  result,
  progressStep,
}: Pick<IJobProgress, "target" | "current" | "result" | "progressStep">): Progression {
  const resultCurrent = result?.current != null ? Number(result.current) : null;
  const resultTotal = result?.total != null ? Number(result.total) : null;
  const resultStage = result?.stage ? String(result.stage) : null;
  const useProps = Boolean(target && current);
  return {
    current: useProps ? current : (resultCurrent ?? current),
    target: useProps ? target : (resultTotal ?? target),
    step: progressStep || resultStage,
  };
}

/**
 * The bar is the primary colour whatever the outcome, except a hard failure (red) and a cancelled
 * job (grey). How a job ended is said by its status chip (JobStatusChip): a green or orange bar
 * across the whole list was louder than the photos.
 */
const BAR_COLOR: Record<JobOutcome, string | undefined> = {
  queued: undefined,
  running: undefined,
  completed: undefined,
  partial_failure: undefined,
  failed: "red",
  cancelled: "gray",
};

/** How full the bar is: a finished job's is full, unless it was cancelled part way. */
function barValue(outcome: JobOutcome, { current, target }: Progression): number {
  if (outcome === "queued") return 0;
  if (outcome === "running" || outcome === "cancelled") {
    return target ? Math.min(100, (current / target) * 100) : 0;
  }
  return 100;
}

/**
 * A job's progress: a 4px bar with "current / target" after it, and the job's own step under it
 * while it runs. The count's tooltip says it as a sentence, with the percentage while it runs.
 */
export function JobProgress({ finished, failed = false, cancelled = false, result, ...props }: IJobProgress) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const progress = progression({ ...props, result });
  const { current, target, step } = progress;
  // Unfinished, a job with a target is under way: the list has no start time to go by here
  const outcome: JobOutcome = finished
    ? jobOutcome({ finished, failed, cancelled, result })
    : target > 0
      ? "running"
      : "queued";
  const running = outcome === "running" && target > 0;
  const sentence = running
    ? t("joblist.itemsprocessedpercent", { count: current, percent: formatPercent(current / target, locale) })
    : t("joblist.itemsprocessed", { count: current });
  const count = target
    ? `${formatCount(current, locale)} / ${formatCount(target, locale)}`
    : formatCount(current, locale);

  return (
    <div>
      <div className={classes.row}>
        <Progress
          className={classes.bar}
          size={4}
          color={BAR_COLOR[outcome]}
          value={barValue(outcome, progress)}
          aria-label={sentence}
        />
        {outcome === "queued" ? (
          <span className={classes.count} data-count />
        ) : (
          <Tooltip label={sentence}>
            <Text size="xs" c="dimmed" className={classes.count} data-count>
              {count}
            </Text>
          </Tooltip>
        )}
      </div>
      {running && step ? (
        <Text size="xs" c="dimmed" truncate>
          {step}
        </Text>
      ) : null}
    </div>
  );
}
