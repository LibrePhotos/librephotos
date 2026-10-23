import type { JobDetail } from "@librephotos/api-client";
import { Badge, Box, Button, Card, Code, Container, Space, Stack, Table, Text, Title } from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBan,
  IconCheck,
  IconClock,
  IconListDetails,
  IconRefresh,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { useJobQuery } from "../../api_client/jobs/hooks";
import { parseInstant } from "../../util/dateUtils";
import { EmptyState } from "../common/EmptyState";
import { PageLoader } from "../common/PageLoader";
import { PageHeader } from "../PageHeader";
import { CancelJobButton } from "./CancelJobButton";
import { CHECK_FILE_CONTENTS_JOB_TYPE, parseCheckFileContentsResult } from "./checkFileContentsResult";
import { CheckFileContentsResults } from "./CheckFileContentsResults";
import { DeleteJobButton } from "./DeleteJobButton";
import { formatJobDuration } from "./JobDuration";
import { JobProgress } from "./JobProgress";
import { JOB_OUTCOME_COLOR, jobOutcome } from "./jobStatus";
import { jobTypeLabel } from "./jobTypeLabel";

type IJobDetailView = Readonly<{
  jobId: number;
  /** Where the Back button returns to — the admin area or the user's own job list. */
  backTo: string;
}>;

// Array.isArray on its own leaves the items unchecked; here they stay unknown until each is read
const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);

const STATUS_ICONS = {
  queued: IconClock,
  running: IconRefresh,
  failed: IconBan,
  cancelled: IconBan,
  partial_failure: IconAlertTriangle,
  completed: IconCheck,
};

/** Who started the job: their full name, or their username without one. */
function startedByName({ started_by: user }: Pick<JobDetail, "started_by">): string {
  return user.first_name || user.last_name ? `${user.first_name} ${user.last_name}`.trim() : user.username;
}

/** The report of a finished job whose type has one of its own, shown above the raw result. */
function JobReport({ job }: Readonly<{ job: JobDetail }>) {
  if (job.job_type !== CHECK_FILE_CONTENTS_JOB_TYPE || !job.finished) return null;
  const contentCheck = parseCheckFileContentsResult(job.result);
  return contentCheck ? <CheckFileContentsResults result={contentCheck} /> : null;
}

export function JobDetailView({ jobId, backTo }: IJobDetailView) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const { data: job, isLoading, isError } = useJobQuery(jobId);

  const backButton = (
    <Button
      variant="subtle"
      leftSection={<IconArrowLeft size={16} />}
      onClick={() => void navigate({ to: backTo })}
      // Pulled left by its padding so the arrow lines up with the heading
      style={{ alignSelf: "flex-start" }}
      px="xs"
      ml="calc(var(--mantine-spacing-xs) * -1)"
      mt="md"
    >
      {t("back")}
    </Button>
  );

  if (isLoading) {
    return (
      <Container>
        <PageLoader label={t("joblist.loadingdetails")} />
      </Container>
    );
  }

  if (isError || !job) {
    return (
      <Container>
        <Stack>
          {backButton}
          <EmptyState
            icon={<IconListDetails size={40} />}
            title={t("joblist.loadfailed")}
            description={t("joblist.loadfaileddescription")}
          />
        </Stack>
      </Container>
    );
  }

  const errorMessage = job.result?.error ? String(job.result.error) : null;
  const outcome = jobOutcome(job);
  const color = JOB_OUTCOME_COLOR[outcome];
  const errorCount = job.result?.error_count != null ? Number(job.result.error_count) : 0;
  const reportedErrors = job.result?.errors;
  const failedItems = isUnknownArray(reportedErrors) ? reportedErrors.map(String) : [];
  const StatusIcon = STATUS_ICONS[outcome];

  const statusLabels = {
    queued: t("joblist.queued"),
    running: t("topmenu.running"),
    failed: t("joblist.failed"),
    cancelled: t("joblist.cancelled"),
    partial_failure: t("joblist.partialfailurebadge"),
    completed: t("joblist.completed"),
  };

  const formatTime = (iso: string) => parseInstant(iso).toLocaleString(DateTime.DATETIME_MED);

  const resultCode = (
    <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "400px", overflow: "auto" }}>
      {JSON.stringify(job.result, null, 2)}
    </Code>
  );

  return (
    <Container>
      <Stack>
        {backButton}
        {/* Same header as the job list it was opened from */}
        <PageHeader
          icon={StatusIcon}
          iconColor={color}
          title={jobTypeLabel(job, t)}
          // The list's own buttons, so a job is stopped or removed the same way from both (#2213).
          // Cancel hides itself once the job has finished.
          actions={
            <>
              <CancelJobButton job={job} />
              <DeleteJobButton job={job} onDeleted={() => void navigate({ to: backTo })} />
            </>
          }
        />

        <Card shadow="md">
          <Title order={4} mb={16}>
            {t("joblist.jobinformation")}
          </Title>
          <Table striped>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td fw={600}>{t("joblist.jobid")}</Table.Td>
                <Table.Td>
                  <Code style={{ wordBreak: "break-all" }}>{job.job_id}</Code>
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td fw={600}>{t("joblist.status")}</Table.Td>
                <Table.Td>
                  <Badge color={color}>{statusLabels[outcome]}</Badge>
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td fw={600}>{t("joblist.queuedat")}</Table.Td>
                <Table.Td>{formatTime(job.queued_at)}</Table.Td>
              </Table.Tr>
              {job.started_at && (
                <Table.Tr>
                  <Table.Td fw={600}>{t("joblist.startedat")}</Table.Td>
                  <Table.Td>{formatTime(job.started_at)}</Table.Td>
                </Table.Tr>
              )}
              {job.finished_at && (
                <Table.Tr>
                  <Table.Td fw={600}>{t("joblist.finishedat")}</Table.Td>
                  <Table.Td>{formatTime(job.finished_at)}</Table.Td>
                </Table.Tr>
              )}
              <Table.Tr>
                <Table.Td fw={600}>{t("joblist.duration")}</Table.Td>
                <Table.Td>
                  {/* Same format as the list's Duration column */}
                  {job.started_at && (job.finished_at || !job.finished)
                    ? formatJobDuration(job.started_at, job.finished_at)
                    : "—"}
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td fw={600}>{t("joblist.startedby")}</Table.Td>
                <Table.Td>{startedByName(job)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td fw={600}>{t("joblist.progress")}</Table.Td>
                <Table.Td>
                  <JobProgress
                    target={job.progress_target}
                    current={job.progress_current}
                    failed={job.failed}
                    cancelled={job.cancelled}
                    finished={job.finished}
                    result={job.result}
                    progressStep={job.progress_step}
                  />
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Card>

        <JobReport job={job} />

        {outcome === "failed" && (
          <Card shadow="md" style={{ border: "1px solid var(--mantine-color-red-6)" }}>
            <Title order={4} mb={16} c="red">
              {t("joblist.errordetails")}
            </Title>
            <Stack gap="sm">
              {errorMessage && (
                <Box>
                  <Text fw={600} mb="xs">
                    {t("joblist.errormessage")}
                  </Text>
                  <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {errorMessage}
                  </Code>
                </Box>
              )}
              {job.result && (
                <Box>
                  <Text fw={600} mb="xs">
                    {t("joblist.resultdata")}
                  </Text>
                  {resultCode}
                </Box>
              )}
            </Stack>
          </Card>
        )}

        {/* Partial failure: some items failed, the job as a whole did not */}
        {outcome === "partial_failure" && (
          <Card shadow="md" style={{ border: "1px solid var(--mantine-color-orange-6)" }}>
            <Title order={4} mb={16} c="orange">
              {t("joblist.partialfailurebadge")}
            </Title>
            <Stack gap="sm">
              <Text size="sm">{t("joblist.partialfailure", { errorCount, total: job.progress_target })}</Text>
              {failedItems.length > 0 && (
                <Box>
                  <Text fw={600} mb="xs">
                    {t("joblist.faileditems")}
                  </Text>
                  <Code
                    block
                    style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "400px", overflow: "auto" }}
                  >
                    {failedItems.join("\n")}
                  </Code>
                </Box>
              )}
            </Stack>
          </Card>
        )}

        {/* A cancelled job's result is only {"status": "cancelled"}, which the status already says */}
        {(outcome === "completed" || outcome === "running" || outcome === "queued") &&
          job.result &&
          Object.keys(job.result).length > 0 && (
            <Card shadow="md">
              <Title order={4} mb={16}>
                {t("joblist.resultdata")}
              </Title>
              {resultCode}
            </Card>
          )}
        <Space h="xl" />
      </Stack>
    </Container>
  );
}
