import type { JobDetail } from "@librephotos/api-client";
import { Alert, Anchor, Text } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { jobTypeLabel } from "../job/jobTypeLabel";

type JobQueueBusyNoticeProps = Readonly<{
  /** The running job when the user may see it; null for another user's job. */
  job: JobDetail | null;
}>;

/**
 * Says why every job button on the page is disabled: a job is running (#2237). The buttons also carry
 * the reason, but only on hover or focus; this line is there without either, on phones too.
 */
export function JobQueueBusyNotice({ job }: JobQueueBusyNoticeProps) {
  const { t } = useTranslation();
  return (
    <Alert
      color="blue"
      icon={<IconInfoCircle />}
      title={job ? t("jobs.queuebusy.title", { job: jobTypeLabel(job, t) }) : t("jobs.queuebusy.titleother")}
      data-testid="job-queue-busy"
    >
      <Text size="sm">
        {t("jobs.queuebusy.wait")}{" "}
        {job && (
          <Anchor component={Link} to="/jobs" size="sm">
            {t("jobs.queuebusy.joblist")}
          </Anchor>
        )}
      </Text>
    </Alert>
  );
}
