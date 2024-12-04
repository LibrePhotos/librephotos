import { Alert, Card, Flex, Loader, Pagination, Table, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconAlertCircle as AlertCircle } from "@tabler/icons-react";
import { DateTime } from "luxon";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { JobsResponseSchema, useJobsQuery } from "../../api_client/admin-jobs";
import { i18nResolvedLanguage } from "../../i18n";
import { DeleteJobButton } from "./DeleteJobButton";
import { JobDuration } from "./JobDuration";
import { JobIndicator } from "./JobIndicator";
import { JobProgress } from "./JobProgress";

export function JobList() {
  const { t } = useTranslation();
  const matches = useMediaQuery("(min-width: 700px)");
  const [jobCount, setJobCount] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [pageSize] = useState(10);

  const { data: jobs, isLoading } = useJobsQuery({ page: activePage, pageSize }, { pollingInterval: 2000 });

  useEffect(() => {
    if (!jobs) {
      return;
    }
    const data = JobsResponseSchema.parse(jobs);
    if (data) {
      setJobCount(data.count);
    }
  }, [jobs]);

  return (
    <Card shadow="md">
      <Title order={3} mb={20}>
        {t("joblist.workerlogs")} {isLoading ? <Loader size="xs" /> : null}
      </Title>
      <Alert icon={<AlertCircle />} title="Removing entries" mb={20}>
        {t("joblist.removeexplanation")}
      </Alert>
      <Table striped highlightOnHover verticalSpacing="xs">
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
                <Table.Th> {t("joblist.startedby")}</Table.Th>
              </>
            )}
            <Table.Th> {t("joblist.delete")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {jobs?.results.map(job => (
            <Table.Tr key={job.job_id}>
              <Table.Td>
                <JobIndicator job={Object.create(job)} />
              </Table.Td>
              <Table.Td>{t(job.job_type_str)}</Table.Td>
              <Table.Td>
                <JobProgress
                  target={job.progress_target}
                  current={job.progress_current}
                  error={job.error}
                  finished={job.finished}
                />
              </Table.Td>
              {matches && (
                <>
                  <Table.Td>{DateTime.fromISO(job.queued_at).setLocale(i18nResolvedLanguage()).toRelative()}</Table.Td>
                  <Table.Td>
                    {job.started_at
                      ? DateTime.fromISO(job.started_at!).setLocale(i18nResolvedLanguage()).toRelative()
                      : ""}
                  </Table.Td>
                </>
              )}

              <JobDuration
                matches={matches}
                finished={job.finished}
                finishedAt={job.finished_at}
                startedAt={job.started_at}
              />
              {matches && <Table.Td>{job.started_by.username}</Table.Td>}
              <Table.Td>
                <DeleteJobButton job={job} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
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
