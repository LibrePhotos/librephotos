import { Alert, Card, Center, Flex, Group, Loader, Pagination, Table, Text, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconAlertCircle as AlertCircle } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { DateTime } from "luxon";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useJobsQuery } from "../../api_client/jobs/hooks";
import { i18nResolvedLanguage } from "../../i18n";
import { CancelJobButton } from "./CancelJobButton";
import { DeleteJobButton } from "./DeleteJobButton";
import { JobDuration } from "./JobDuration";
import { JobIndicator } from "./JobIndicator";
import { JobProgress } from "./JobProgress";

type IJobList = Readonly<{
  /**
   * Which surface this list is rendered on: the admin area's global list, or a
   * single user's own jobs at /jobs (issue #1909).
   *
   * These travel as one prop rather than separate flags because they are not
   * independent — asking the backend to narrow the list is what makes dropping
   * the "Started By" column correct. Set apart, they could be combined into a
   * list that hides whose jobs it is showing.
   */
  variant?: "admin" | "mine";
}>;

export function JobList({ variant = "admin" }: IJobList) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const matches = useMediaQuery("(min-width: 700px)");
  const [jobCount, setJobCount] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [pageSize] = useState(10);
  const mine = variant === "mine";

  const { data: jobs, isLoading } = useJobsQuery({ page: activePage, pageSize, mine }, { pollingInterval: 2000 });

  useEffect(() => {
    if (!jobs) {
      return;
    }
    setJobCount(jobs.count);
  }, [jobs]);

  return (
    <Card shadow="md">
      {/* On /jobs the page heading already says "My Jobs"; a card title repeating it read as a second page title. */}
      {!mine && (
        <Title order={4} mb={16}>
          {t("joblist.workerlogs")} {isLoading ? <Loader size="xs" /> : null}
        </Title>
      )}
      <Alert icon={<AlertCircle />} title={t("joblist.removeentries")} mb={16}>
        {t("joblist.removeexplanation")}
      </Alert>
      {/* Scrolls sideways on a phone instead of clipping the action buttons at the card edge */}
      <Table.ScrollContainer minWidth={280} type="native">
        {/* Tighter cells on a phone so the four columns fit without scrolling */}
        <Table striped highlightOnHover verticalSpacing="xs" horizontalSpacing={matches ? "xs" : 6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th> {t("joblist.status")}</Table.Th>
              <Table.Th> {t("joblist.jobtype")}</Table.Th>
              <Table.Th> {t("joblist.progress")}</Table.Th>
              {matches && (
                <>
                  <Table.Th> {t("joblist.queued")}</Table.Th>
                  <Table.Th> {t("joblist.started")}</Table.Th>
                  <Table.Th> {t("joblist.duration")}</Table.Th>
                  {!mine && <Table.Th> {t("joblist.startedby")}</Table.Th>}
                </>
              )}
              {/* One column for Cancel and Remove: Cancel only exists while a job runs, so its own column was empty on almost every row */}
              <Table.Th> {t("joblist.actions")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {jobs?.results.map(job => (
              <Table.Tr
                key={job.job_id}
                style={{ cursor: "pointer" }}
                onClick={e => {
                  // Don't navigate if clicking on the delete button or its container
                  const target = e.target as HTMLElement;
                  if (target.closest("button") || target.closest('[role="button"]')) {
                    return;
                  }
                  navigate({ to: `${mine ? "/jobs" : "/admin/job"}/${job.id}` });
                }}
              >
                <Table.Td>
                  <JobIndicator job={Object.create(job)} />
                </Table.Td>
                <Table.Td>{t(job.job_type_str)}</Table.Td>
                <Table.Td>
                  <JobProgress
                    target={job.progress_target}
                    current={job.progress_current}
                    failed={job.failed}
                    cancelled={job.cancelled}
                    error={job.error}
                    finished={job.finished}
                    result={job.result}
                    progressStep={job.progress_step}
                  />
                </Table.Td>
                {matches && (
                  <>
                    <Table.Td>
                      {DateTime.fromISO(job.queued_at).setLocale(i18nResolvedLanguage()).toRelative()}
                    </Table.Td>
                    <Table.Td>
                      {job.started_at
                        ? DateTime.fromISO(job.started_at!).setLocale(i18nResolvedLanguage()).toRelative()
                        : ""}
                    </Table.Td>
                  </>
                )}

                <JobDuration
                  matches={!!matches}
                  finished={job.finished}
                  finishedAt={job.finished_at}
                  startedAt={job.started_at}
                />
                {matches && !mine && <Table.Td>{job.started_by.username}</Table.Td>}
                <Table.Td onClick={e => e.stopPropagation()}>
                  <Group gap="xs" wrap="nowrap">
                    <CancelJobButton job={job} />
                    <DeleteJobButton job={job} />
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {(isLoading || jobs?.results.length === 0) && (
              <Table.Tr>
                <Table.Td colSpan={matches ? (mine ? 7 : 8) : 4}>
                  <Center py="md">
                    {isLoading ? (
                      <Loader size="sm" />
                    ) : (
                      <Text size="sm" c="dimmed">
                        {t("joblist.empty")}
                      </Text>
                    )}
                  </Center>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Flex justify="center" mt={20}>
        <Pagination
          total={Math.ceil(+jobCount.toFixed(1) / pageSize)}
          onChange={newPage => setActivePage(newPage)}
          withEdges
        />
      </Flex>
    </Card>
  );
}
