import { Indicator, Popover, Progress, Stack, Text } from "@mantine/core";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useWorkerStatus } from "../../hooks/useWorkerStatus";
import type { IJobDetailSchema } from "../../store/worker/worker.zod";

interface IWorkerIndicator {
  workerRunningJob: IJobDetailSchema;
}

function WorkerRunningJob({ workerRunningJob }: IWorkerIndicator) {
  const { t } = useTranslation();

  if (workerRunningJob && workerRunningJob.result && workerRunningJob.result.progress) {
    return (
      <Stack>
        <Progress
          value={(+workerRunningJob.result.progress.current.toFixed(2) / workerRunningJob.result.progress.target) * 100}
        />
        <Text size="sm" align="center">
          {workerRunningJob.result.progress.current} / {workerRunningJob.result.progress.target}
        </Text>
        <Text size="sm" align="center">
          {t("topmenu.running")} {workerRunningJob.job_type_str} ...
        </Text>
      </Stack>
    );
  }
  return <>{t("topmenu.busy")}</>;
}

export function WorkerIndicator() {
  const { t } = useTranslation();
  const { workerRunningJob, currentData } = useWorkerStatus();

  const [canWorkerAcceptJob, setCanWorkerAcceptJob] = useState("red");
  useEffect(() => {
    setCanWorkerAcceptJob(
      currentData?.queue_can_accept_job === undefined || currentData?.queue_can_accept_job === false ? "red" : "green"
    );
  }, [currentData?.queue_can_accept_job]);

  const [opened, setOpened] = useState(false);
  const openModalCallback = useCallback(() => {
    setOpened(true);
  }, []);

  const closeModalCallback = useCallback(() => {
    setOpened(false);
  }, []);

  return (
    <Popover
      opened={opened}
      onClose={() => setOpened(false)}
      width={260}
      target={
        <Indicator onMouseEnter={openModalCallback} onMouseLeave={closeModalCallback} color={canWorkerAcceptJob}>
          <div />
        </Indicator>
      }
      position="bottom"
      withArrow
    >
      <Text size="sm">
        {currentData?.queue_can_accept_job ? (
          t("topmenu.available")
        ) : (
          <WorkerRunningJob workerRunningJob={workerRunningJob} />
        )}
      </Text>
    </Popover>
  );
}
