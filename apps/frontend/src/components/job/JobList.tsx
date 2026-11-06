import type { Job } from "@librephotos/api-client";
import {
  Anchor,
  Card,
  Center,
  Flex,
  Group,
  Loader,
  Pagination,
  Table,
  Text,
  Title,
  VisuallyHidden,
} from "@mantine/core";
import { Link, useNavigate } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useJobsQuery } from "../../api_client/jobs/hooks";
import { parseInstant } from "../../util/dateUtils";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { SectionLink } from "../settings/SettingsSection";
import { CancelJobButton } from "./CancelJobButton";
import { JobActionsMenu } from "./JobActionsMenu";
import classes from "./JobList.module.css";
import { JobListProgress } from "./JobListProgress";
import { JobStatusChip } from "./JobStatusChip";
import { jobTypeLabel } from "./jobTypeLabel";

type IJobList = Readonly<{
  /**
   * Which surface this list is rendered on: the admin area's global list, or a
   * single user's own jobs at /jobs (issue #1909).
   *
   * These travel as one prop rather than separate flags because they are not
   * independent — asking the backend to narrow the list is what makes dropping
   * whose job it is correct. Set apart, they could be combined into a
   * list that hides whose jobs it is showing.
   */
  variant?: "admin" | "mine";
}>;

/** A job's detail page on each surface: the admin area's, or the user's own at /jobs. */
const DETAIL_ROUTE = { admin: "/admin/job/$id", mine: "/jobs/$id" } as const;

/** Every row has the same four cells on every screen: job, progress, status and its menu. */
const COLUMNS = 4;

/** A click on the row itself, not on a control inside it that does its own thing. */
function isPlainRowClick(target: EventTarget) {
  return !(target instanceof Element && target.closest('a, button, [role="button"]'));
}

/** "1 hour ago", and on the admin list whose job it is; the duration has the progress column. */
function jobMeta(job: Job, withUser: boolean): string {
  const when = parseInstant(job.started_at ?? job.queued_at).toRelative();
  return [when, withUser ? job.started_by.username : null].filter(Boolean).join(" · ");
}

export function JobList({ variant = "admin" }: IJobList) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [jobCount, setJobCount] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [pageSize] = useState(10);
  const mine = variant === "mine";
  const detailRoute = DETAIL_ROUTE[variant];

  const jobsQuery = useJobsQuery({ page: activePage, pageSize, mine });
  const { data: jobs, isLoading } = jobsQuery;
  const listFailure = useListFailure(jobsQuery);

  useEffect(() => {
    if (!jobs) {
      return;
    }
    setJobCount(jobs.count);
  }, [jobs]);

  return (
    <Card withBorder radius="lg" padding="lg">
      {/* On /jobs the page heading already says "My Jobs"; a card title repeating it read as a second page title. */}
      {!mine && (
        <Title order={4} mb={16}>
          {t("joblist.workerlogs")}
          <SectionLink /> {isLoading ? <Loader size="xs" /> : null}
        </Title>
      )}
      {/* Scrolls sideways on a phone instead of clipping the menu at the card edge */}
      <Table.ScrollContainer minWidth={320} type="native">
        <Table highlightOnHover className={classes.table} horizontalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("joblist.jobtype")}</Table.Th>
              <Table.Th>{t("joblist.progress")}</Table.Th>
              <Table.Th>{t("joblist.status")}</Table.Th>
              {/* Cancel (while a job runs) and the ⋮ menu */}
              <Table.Th>
                <VisuallyHidden>{t("joblist.actions")}</VisuallyHidden>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {jobs?.results.map(job => (
              <Table.Tr
                key={job.job_id}
                className={classes.row}
                // A mouse convenience: the job type is the link the keyboard reaches (#2228)
                onClick={e => {
                  if (isPlainRowClick(e.target)) {
                    void navigate({ to: detailRoute, params: { id: String(job.id) } });
                  }
                }}
              >
                <Table.Td>
                  <Anchor
                    c="inherit"
                    size="sm"
                    fw={500}
                    underline="hover"
                    // renderRoot, not component={Link}: only this way are `to` and `params` type-checked
                    renderRoot={props => <Link to={detailRoute} params={{ id: String(job.id) }} {...props} />}
                  >
                    {jobTypeLabel(job, t)}
                  </Anchor>
                  <Text size="xs" c="dimmed">
                    {jobMeta(job, !mine)}
                  </Text>
                </Table.Td>
                <Table.Td className={classes.progressCell}>
                  <JobListProgress job={job} />
                </Table.Td>
                <Table.Td className={classes.chipCell}>
                  <JobStatusChip job={job} />
                </Table.Td>
                <Table.Td className={classes.actionsCell} onClick={e => e.stopPropagation()}>
                  <Group gap={4} wrap="nowrap" justify="flex-end">
                    <CancelJobButton job={job} />
                    <JobActionsMenu job={job} />
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {listFailure && (
              <Table.Tr>
                <Table.Td colSpan={COLUMNS}>
                  <ErrorState failure={listFailure} compact />
                </Table.Td>
              </Table.Tr>
            )}
            {(isLoading || jobs?.results.length === 0) && (
              <Table.Tr>
                <Table.Td colSpan={COLUMNS}>
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
