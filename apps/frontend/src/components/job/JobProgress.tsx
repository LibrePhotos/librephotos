import { Center, Progress, Text, Tooltip } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

type IJobProgress = Readonly<{
  target?: number;
  current?: number;
  finished: boolean;
  error: unknown;
  result?: Record<string, unknown> | null;
  progressStep?: string | null;
}>;

export function JobProgress({ target = 0, current = 0, finished, error, result, progressStep }: IJobProgress) {
  const { t } = useTranslation();

  // Extract error message from result if available
  const errorMessage = result?.error ? String(result.error) : error ? String(error) : null;

  if (target && current && target !== 0 && !finished) {
    return (
      <div>
        <Progress size={10} value={(+current.toFixed(2) / target) * 100} />
        <Center>
          {progressStep ? (
            <Text size="sm">{progressStep}</Text>
          ) : (
            `${current} ${t("joblist.itemsadded")} (${((+current.toFixed(2) / target) * 100).toFixed(2)} %) `
          )}
        </Center>
      </div>
    );
  }
  if (finished) {
    const hasFailed = error || result?.error || result?.status === "failed";
    return (
      <div>
        <Progress size={10} color={hasFailed ? "red" : "green"} value={100} />
        <Center>
          {hasFailed && errorMessage ? (
            <Tooltip label={errorMessage} multiline w={300}>
              <Text size="sm" c="red" style={{ cursor: "help" }}>
                {t("joblist.failed")}
              </Text>
            </Tooltip>
          ) : (
            `${current} ${t("joblist.itemsadded")} `
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
