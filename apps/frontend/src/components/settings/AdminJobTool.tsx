import type { JobDetail } from "@librephotos/api-client";
import { Anchor, Badge, Button, Flex, Group, Stack, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useWorkerQuery } from "../../api_client/jobs/hooks";
import { JOB_OUTCOME_COLOR, jobOutcome } from "../job/jobStatus";

/** The job of `jobType` the worker is on, if it is on one. */
function runningJob(job: JobDetail | null | undefined, jobType: number): JobDetail | null {
  return job && !job.finished && job.job_type === jobType ? job : null;
}

function percentDone(job: JobDetail): number {
  return job.progress_target > 0 ? Math.floor((job.progress_current / job.progress_target) * 100) : 0;
}

function RunningLine({ job }: Readonly<{ job: JobDetail }>) {
  const { t } = useTranslation();
  // Queued until the worker takes it: another job may still be running.
  const outcome = jobOutcome(job) === "queued" ? "queued" : "running";
  return (
    <Group gap="xs">
      <Badge color={JOB_OUTCOME_COLOR[outcome]} size="sm">
        {outcome === "queued" ? t("joblist.queued") : t("adminarea.jobrunning")}
      </Badge>
      <Text size="sm" c="dimmed">
        {t("adminarea.jobpercent", { percent: percentDone(job) })}
      </Text>
      <Anchor size="sm" renderRoot={props => <Link to="/admin/job/$id" params={{ id: String(job.id) }} {...props} />}>
        {t("adminarea.viewjob")}
      </Anchor>
    </Group>
  );
}

type Props = Readonly<{
  /** LongRunningJob.JOB_* of the job the row starts. */
  jobType: number;
  title: string;
  explanation: string;
  buttonWidth: number;
  isPending: boolean;
  onStart: () => void;
}>;

/**
 * An Admin Tools row that starts an instance-wide job. While the job runs, the row says how far it
 * got and links to it, and the button stays disabled.
 */
export function AdminJobTool({ jobType, title, explanation, buttonWidth, isPending, onStart }: Props) {
  const { t } = useTranslation();
  const { data: worker } = useWorkerQuery();
  const running = runningJob(worker?.job_detail, jobType);

  return (
    // Wraps the button under the text on a phone; the explanation is too long to share a row there.
    <Flex justify="space-between" align="center" gap="md" wrap="wrap">
      <Stack gap={2} flex="1 1 260px">
        <Text>{title}</Text>
        <Text size="sm" c="dimmed">
          {explanation}
        </Text>
        {running ? <RunningLine job={running} /> : null}
      </Stack>
      <Button miw={buttonWidth} loading={isPending} disabled={running !== null} onClick={onStart}>
        {running ? t("adminarea.jobrunning") : t("adminarea.start")}
      </Button>
    </Flex>
  );
}
