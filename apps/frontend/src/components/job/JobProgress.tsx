import { Center, Progress, Text, Tooltip } from "@mantine/core";
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

export function JobProgress({ target = 0, current = 0, finished, failed = false, error, result, progressStep }: IJobProgress) {
  const { t } = useTranslation();

  // Extract error message from result if available
  const errorMessage = result?.error ? String(result.error) : error ? String(error) : null;

  // Extract progress from result if direct props are not available
  const resultCurrent = result?.current != null ? Number(result.current) : null;
  const resultTotal = result?.total != null ? Number(result.total) : null;
  const resultStage = result?.stage ? String(result.stage) : null;

  // Use result values as fallback if direct props are not available or are 0
  const effectiveCurrent = (target && current && target !== 0) ? current : (resultCurrent ?? current);
  const effectiveTarget = (target && current && target !== 0) ? target : (resultTotal ?? target);
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
    const hasFailed = failed || error || result?.error || result?.status === "failed";
    const finalCurrent = effectiveCurrent ?? current;
    return (
      <div>
        <Progress size={10} color={hasFailed ? "red" : "green"} value={100} />
        <Center>
          {hasFailed ? (
            errorMessage ? (
              <Tooltip label={errorMessage} multiline w={300}>
                <Text size="sm" c="red" style={{ cursor: "help" }}>
                  {t("joblist.failed")}
                </Text>
              </Tooltip>
            ) : (
              <Text size="sm" c="red">
                {t("joblist.failed")}
              </Text>
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
