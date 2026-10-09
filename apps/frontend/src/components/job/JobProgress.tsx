import { Box, Center, Progress, Text, Tooltip } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { JOB_OUTCOME_COLOR, jobOutcome } from "./jobStatus";

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

export function JobProgress({
  target = 0,
  current = 0,
  finished,
  failed = false,
  cancelled = false,
  error,
  result,
  progressStep,
}: IJobProgress) {
  const { t } = useTranslation();

  // Extract error message from result if available
  const errorMessage = result?.error ? String(result.error) : error ? String(error) : null;

  // Extract progress from result if direct props are not available
  const resultCurrent = result?.current != null ? Number(result.current) : null;
  const resultTotal = result?.total != null ? Number(result.total) : null;
  const resultStage = result?.stage ? String(result.stage) : null;

  // Use result values as fallback if direct props are not available or are 0
  const effectiveCurrent = target && current && target !== 0 ? current : (resultCurrent ?? current);
  const effectiveTarget = target && current && target !== 0 ? target : (resultTotal ?? target);
  const effectiveProgressStep = progressStep || resultStage;

  // "Asset(s) added" was wrong for most job types (geolocation, OCR, model
  // downloads add nothing), so counts read as items processed.
  if (effectiveTarget && effectiveCurrent != null && effectiveTarget !== 0 && !finished) {
    return (
      <div>
        <Progress size={10} value={(+effectiveCurrent.toFixed(2) / effectiveTarget) * 100} />
        <Center>
          <Text size="sm" ta="center">
            {effectiveProgressStep ||
              `${t("joblist.itemsprocessed", { count: effectiveCurrent })} (${((+effectiveCurrent.toFixed(2) / effectiveTarget) * 100).toFixed(2)} %)`}
          </Text>
        </Center>
      </div>
    );
  }
  if (finished) {
    const outcome = jobOutcome({ finished, failed, cancelled, result });
    const errorCount = result?.error_count != null ? Number(result.error_count) : 0;
    const finalCurrent = effectiveCurrent ?? current;
    // A cancelled job shows how far it got instead of a full bar.
    const value =
      outcome === "cancelled" && effectiveTarget ? Math.min(100, (finalCurrent / effectiveTarget) * 100) : 100;

    let label: React.ReactNode;
    if (outcome === "failed") {
      label = (
        <Text size="sm" c="red">
          {t("joblist.failed")}
        </Text>
      );
    } else if (outcome === "partial_failure") {
      label = (
        <Text size="sm" c="orange" ta="center">
          {t("joblist.partialfailure", { errorCount, total: effectiveTarget || finalCurrent })}
        </Text>
      );
    } else if (outcome === "cancelled") {
      label = (
        <Text size="sm" c="dimmed">
          {t("joblist.cancelled")}
        </Text>
      );
    } else {
      label = (
        <Text size="sm" ta="center">
          {t("joblist.itemsprocessed", { count: finalCurrent })}
        </Text>
      );
    }
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
  return (
    <div>
      <Progress size={10} color="blue" value={0} />
      <Center>
        <Text size="sm">{t("joblist.waiting")}</Text>
      </Center>
    </div>
  );
}
