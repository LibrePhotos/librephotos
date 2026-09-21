import { Anchor, Button, Indicator, Popover, Progress, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useNavigate } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCancelJobMutation } from "../../api_client/jobs/hooks";
import { JobDetail } from "../../api_client/jobs/types";
import { useWorkerStatus } from "../../hooks/useWorkerStatus";

type IWorkerIndicator = Readonly<{
  workerRunningJob: JobDetail;
}>;

function WorkerRunningJob({ workerRunningJob }: IWorkerIndicator) {
  const { t } = useTranslation();
  const { mutate: cancelJob, isPending } = useCancelJobMutation();

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
        {!workerRunningJob.finished && !workerRunningJob.cancelled && (
          <Button
            onClick={() => cancelJob(workerRunningJob.id)}
            color="red"
            variant="outline"
            size="xs"
            loading={isPending}
          >
            {t("joblist.cancel")}
          </Button>
        )}
      </Stack>
    );
  }
  return <>{t("topmenu.busy")}</>;
}

export function WorkerIndicator() {
  const { t } = useTranslation();
  const [opened, { toggle, close }] = useDisclosure(false);
  const [workerColor, setWorkerColor] = useState("red");
  const { workerRunningJob, currentData } = useWorkerStatus();
  const navigate = useNavigate();

  useEffect(() => {
    setWorkerColor(currentData?.queue_can_accept_job ? "green" : "red");
  }, [currentData?.queue_can_accept_job]);

  return (
    // Toggle on click (not hover) so the popover stays open long enough to reach the
    // Cancel button; click-outside and Escape close it via onChange.
    <Popover opened={opened} onChange={value => !value && close()} width={260} position="bottom" withArrow>
      <Popover.Target>
        <Indicator onClick={toggle} style={{ cursor: "pointer" }} color={workerColor}>
          <div />
        </Indicator>
      </Popover.Target>

      <Popover.Dropdown>
        <Stack gap="xs">
          {currentData?.queue_can_accept_job ? (
            <Text size="sm">{t("topmenu.available")}</Text>
          ) : (
            <WorkerRunningJob workerRunningJob={workerRunningJob} />
          )}
          {/* The popover only ever shows the one active job — link out to the full
              per-user list so job history and failures are reachable from here. */}
          <Anchor
            size="xs"
            ta="center"
            onClick={() => {
              close();
              navigate({ to: "/jobs" });
            }}
          >
            {t("topmenu.viewalljobs")}
          </Anchor>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
