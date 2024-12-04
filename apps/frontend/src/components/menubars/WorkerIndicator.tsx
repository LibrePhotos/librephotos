import { Indicator, Popover, Progress, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useWorkerStatus } from "../../hooks/useWorkerStatus";
import type { IJobDetailSchema } from "../../store/worker/worker.zod";

type IWorkerIndicator = Readonly<{
  workerRunningJob: IJobDetailSchema;
}>;

function WorkerRunningJob({ workerRunningJob }: IWorkerIndicator) {
  const { t } = useTranslation();

  if (workerRunningJob) {
    return (
      <Stack>
        <Progress value={(+workerRunningJob.progress_current.toFixed(2) / workerRunningJob.progress_target) * 100} />
        <Text size="sm" ta="center">
          {workerRunningJob.progress_current} / {workerRunningJob.progress_target}
        </Text>
        <Text size="sm" ta="center">
          {t("topmenu.running")} {workerRunningJob.job_type_str} ...
        </Text>
      </Stack>
    );
  }
  return <>{t("topmenu.busy")}</>;
}

export function WorkerIndicator() {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  const [workerColor, setWorkerColor] = useState("red");
  const { workerRunningJob, currentData } = useWorkerStatus();

  useEffect(() => {
    setWorkerColor(currentData?.queue_can_accept_job ? "green" : "red");
  }, [currentData?.queue_can_accept_job]);

  return (
    <Popover opened={opened} width={260} position="bottom" withArrow>
      <Popover.Target>
        <Indicator onMouseEnter={open} onMouseLeave={close} color={workerColor}>
          <div />
        </Indicator>
      </Popover.Target>

      <Popover.Dropdown>
        <Text size="sm">
          {currentData?.queue_can_accept_job ? (
            t("topmenu.available")
          ) : (
            <WorkerRunningJob workerRunningJob={workerRunningJob} />
          )}
        </Text>
      </Popover.Dropdown>
    </Popover>
  );
}
