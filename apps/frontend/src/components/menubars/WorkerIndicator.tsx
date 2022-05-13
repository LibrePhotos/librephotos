import { Indicator, Popover, Progress, Stack, Text } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchWorkerAvailability } from "../../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

export const WorkerIndicator = () => {
  const dispatch = useAppDispatch();
  const workerRunningJob = useAppSelector(state => state.util.workerRunningJob);

  const [opened, setOpened] = useState(false);
  const workerAvailability = useAppSelector(state => state.util.workerAvailability);
  const { t } = useTranslation();
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchWorkerAvailability(workerRunningJob, dispatch);
    }, 2000);
    return () => clearInterval(intervalId);
  }, [dispatch]);

  let runningJobPopupProgress;
  if (workerRunningJob && workerRunningJob.result && workerRunningJob.result.progress) {
    runningJobPopupProgress = (
      <Stack>
        <Progress
          value={(workerRunningJob.result.progress.current.toFixed(2) / workerRunningJob.result.progress.target) * 100}
        ></Progress>
        <Text size="sm" align="center">
          {workerRunningJob.result.progress.current} / {workerRunningJob.result.progress.target}
        </Text>
        <Text size="sm" align="center">
          {t("topmenu.running")} {workerRunningJob.job_type_str} ...
        </Text>
      </Stack>
    );
  }
  return (
    <Popover
      opened={opened}
      onClose={() => setOpened(false)}
      width={260}
      target={
        <Indicator
          onMouseEnter={() => setOpened(true)}
          onMouseLeave={() => setOpened(false)}
          color={!workerAvailability ? "red" : "green"}
        >
          <div></div>
        </Indicator>
      }
      position="bottom"
      withArrow
    >
      <Text size="sm">
        {workerAvailability
          ? t("topmenu.available")
          : !workerAvailability && workerRunningJob
          ? runningJobPopupProgress
          : t("topmenu.busy")}
      </Text>
    </Popover>
  );
};
