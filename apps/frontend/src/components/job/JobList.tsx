import { Alert, Card, Flex, Loader, Pagination, SimpleGrid, Table, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { DateTime } from "luxon";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle } from "tabler-icons-react";

import { JobsResponseSchema, useJobsQuery } from "../../api_client/admin-jobs";
import i18n from "../../i18n";
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
      <Alert icon={<AlertCircle/>} title='Removing entries' mb={20}>
        {t("joblist.removeexplanation")}
      </Alert>
      <Table striped highlightOnHover verticalSpacing="xs">
        <thead>
          <tr>
            <th> {t("joblist.status")}</th>
            <th> {t("joblist.jobtype")}</th>
            <th> {t("joblist.progress")}</th>
            {matches && (
              <>
                <th> {t("joblist.queued")}</th>
                <th> {t("joblist.started")}</th>
                <th> {t("joblist.duration")}</th>
                <th> {t("joblist.startedby")}</th>
              </>
            )}
            <th> {t("joblist.delete")}</th>
          </tr>
        </thead>
        <tbody>
          {jobs?.results.map(job => (
            <tr key={job.job_id}>
              <td>
                <JobIndicator job={Object.create(job)} />
              </td>
              <td>{job.job_type_str}</td>
              <td>
                <JobProgress
                  target={job.result.progress.target}
                  current={job.result.progress.current}
                  error={job.error}
                  finished={job.finished}
                />
              </td>
              {matches && (
                <>
                  <td>
                    {DateTime.fromISO(job.queued_at).setLocale(i18n.resolvedLanguage.replace("_", "-")).toRelative()}
                  </td>
                  <td>
                    {job.started_at
                      ? DateTime.fromISO(job.started_at!)
                          .setLocale(i18n.resolvedLanguage.replace("_", "-"))
                          .toRelative()
                      : ""}
                  </td>
                </>
              )}

              <JobDuration
                matches={matches}
                finished={job.finished}
                finishedAt={job.finished_at}
                startedAt={job.started_at}
              />
              {matches && <td>{job.started_by.username}</td>}
              <td>
                <DeleteJobButton job={job} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Flex justify="center" mt={20}>
      <Pagination
        page={activePage}
        total={Math.ceil(+jobCount.toFixed(1) / pageSize)}
        onChange={newPage => setActivePage(newPage)}
        withEdges
      />
      </Flex>
    </Card>
  );
}
