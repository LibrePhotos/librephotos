import type { JobDetail } from "@librephotos/api-client";
import { Anchor, Badge, Button, Flex, Group, Stack, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useStripThumbnailMetadataMutation, useWorkerQuery } from "../../api_client/jobs/hooks";
import { JOB_OUTCOME_COLOR, jobOutcome } from "../job/jobStatus";

// LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA in the backend.
const STRIP_THUMBNAIL_METADATA_JOB_TYPE = 23;

/** The cleanup job the worker is on, if it is on one. */
function runningCleanup(job: JobDetail | null | undefined): JobDetail | null {
  return job && !job.finished && job.job_type === STRIP_THUMBNAIL_METADATA_JOB_TYPE ? job : null;
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

/**
 * Admin Tools row that starts the thumbnail metadata cleanup (#2321), the job behind
 * `manage.py strip_thumbnail_metadata`. While it runs, the row says how far it got and links to it.
 */
export function StripThumbnailMetadataTool({ buttonWidth }: Readonly<{ buttonWidth: number }>) {
  const { t } = useTranslation();
  const { mutate: start, isPending } = useStripThumbnailMetadataMutation();
  const { data: worker } = useWorkerQuery();
  const running = runningCleanup(worker?.job_detail);

  return (
    // Wraps the button under the text on a phone; the explanation is too long to share a row there.
    <Flex justify="space-between" align="center" gap="md" wrap="wrap">
      <Stack gap={2} flex="1 1 260px">
        <Text>{t("adminarea.stripthumbnailmetadata")}</Text>
        <Text size="sm" c="dimmed">
          {t("adminarea.stripthumbnailmetadataexplanation")}
        </Text>
        {running ? <RunningLine job={running} /> : null}
      </Stack>
      <Button miw={buttonWidth} loading={isPending} disabled={running !== null} onClick={() => start()}>
        {running ? t("adminarea.jobrunning") : t("adminarea.start")}
      </Button>
    </Flex>
  );
}
