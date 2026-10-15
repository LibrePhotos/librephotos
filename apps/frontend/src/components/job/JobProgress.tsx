import { Box, Center, Progress, Text, Tooltip } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { formatPercent } from "../../util/formatCount";
import { JOB_OUTCOME_COLOR, jobOutcome, type JobOutcome } from "./jobStatus";

type IJobProgress = Readonly<{
  target?: number;
  current?: number;
  finished: boolean;
  failed?: boolean;
  cancelled?: boolean;
  error?: unknown;
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

// "Asset(s) added" was wrong for most job types (geolocation, OCR, model
// downloads add nothing), so counts read as items processed.
function RunningProgress({ current, target, step }: Progression) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const fraction = current / target;
  return (
    <div>
      <Progress size={10} value={fraction * 100} />
      <Center>
        <Text size="sm" ta="center">
          {step || t("joblist.itemsprocessedpercent", { count: current, percent: formatPercent(fraction, locale) })}
        </Text>
      </Center>
    </div>
  );
}

type FinishedProps = Readonly<{
  outcome: JobOutcome;
  current: number;
  target: number;
  errorCount: number;
  errorMessage: string | null;
}>;

function FinishedLabel({ outcome, current, target, errorCount }: Omit<FinishedProps, "errorMessage">) {
  const { t } = useTranslation();
  switch (outcome) {
    case "failed":
      return (
        <Text size="sm" c="red">
          {t("joblist.failed")}
        </Text>
      );
    case "partial_failure":
      return (
        <Text size="sm" c="orange" ta="center">
          {t("joblist.partialfailure", { errorCount, total: target || current })}
        </Text>
      );
    case "cancelled":
      return (
        <Text size="sm" c="dimmed">
          {t("joblist.cancelled")}
        </Text>
      );
    case "queued":
    case "running":
    case "completed":
      return (
        <Text size="sm" ta="center">
          {t("joblist.itemsprocessed", { count: current })}
        </Text>
      );
  }
}

function FinishedProgress(props: FinishedProps) {
  const { outcome, current, target, errorMessage } = props;
  // A cancelled job shows how far it got instead of a full bar.
  const value = outcome === "cancelled" && target ? Math.min(100, (current / target) * 100) : 100;
  const label = <FinishedLabel {...props} />;
  const withErrorTooltip = !!errorMessage && (outcome === "failed" || outcome === "partial_failure");
  return (
    <div>
      <Progress size={10} color={JOB_OUTCOME_COLOR[outcome]} value={value} />
      <Center>
        {withErrorTooltip ? (
          <Tooltip label={errorMessage} multiline w={300}>
            <Box style={{ cursor: "help" }}>{label}</Box>
          </Tooltip>
        ) : (
          label
        )}
      </Center>
    </div>
  );
}

export function JobProgress({ finished, failed = false, cancelled = false, error, result, ...props }: IJobProgress) {
  const { t } = useTranslation();
  const { current, target, step } = progression({ ...props, result });

  if (target && !finished) {
    return <RunningProgress current={current} target={target} step={step} />;
  }
  if (finished) {
    // Extract error message from result if available
    const errorMessage = result?.error ? String(result.error) : error ? String(error) : null;
    return (
      <FinishedProgress
        outcome={jobOutcome({ finished, failed, cancelled, result })}
        current={current}
        target={target}
        errorCount={result?.error_count != null ? Number(result.error_count) : 0}
        errorMessage={errorMessage}
      />
    );
  }
  return (
    <div>
      <Progress size={10} color="blue" value={0} />
      <Center>
        <Text size="sm">{t("joblist.waiting")}</Text>
      </Center>
    </div>
  );
}
