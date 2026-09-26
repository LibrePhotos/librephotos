import { Box, Center, Progress, Text, Tooltip } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

type IJobProgress = Readonly<{
  target?: number;
  current?: number;
  finished: boolean;
  failed?: boolean;
  error?: unknown;
  result?: Record<string, unknown> | null;
  progressStep?: string | null;
}>;

export function JobProgress({
  target = 0,
  current = 0,
  finished,
  failed = false,
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

  if (effectiveTarget && effectiveCurrent != null && effectiveTarget !== 0 && !finished) {
    return (
      <div>
        <Progress size={10} value={(+effectiveCurrent.toFixed(2) / effectiveTarget) * 100} />
        <Center>
          {effectiveProgressStep ? (
            <Text size="sm">{effectiveProgressStep}</Text>
          ) : (
            `${effectiveCurrent} ${t("joblist.itemsadded")} (${((+effectiveCurrent.toFixed(2) / effectiveTarget) * 100).toFixed(2)} %) `
          )}
        </Center>
      </div>
    );
  }
  if (finished) {
    // Only a hard failure is red. A scan that errored on a minority of its
    // files reports status "partial_failure" and still sets result.error, so
    // keying off result.error here would paint a 4-in-150k scan as Failed.
    const hasFailed = failed || result?.status === "failed";
    const isPartialFailure = !hasFailed && result?.status === "partial_failure";
    const errorCount = result?.error_count != null ? Number(result.error_count) : 0;
    const finalCurrent = effectiveCurrent ?? current;

    let color = "green";
    if (hasFailed) color = "red";
    else if (isPartialFailure) color = "yellow";

    const label = hasFailed ? (
      <Text size="sm" c="red">
        {t("joblist.failed")}
      </Text>
    ) : isPartialFailure ? (
      <Text size="sm" c="yellow">
        {t("joblist.partialfailure", { errorCount, total: effectiveTarget || finalCurrent })}
      </Text>
    ) : null;

    return (
      <div>
        <Progress size={10} color={color} value={100} />
        <Center>
          {label ? (
            errorMessage ? (
              <Tooltip label={errorMessage} multiline w={300}>
                <Box style={{ cursor: "help" }}>{label}</Box>
              </Tooltip>
            ) : (
              label
            )
          ) : (
            `${finalCurrent} ${t("joblist.itemsadded")} `
          )}
        </Center>
      </div>
    );
  }
  return (
    <div>
      <Progress size={10} color="blue" value={0} />
      <Center>{t("joblist.waiting")}</Center>
    </div>
  );
}
