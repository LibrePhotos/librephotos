import { Loader, Pagination, SimpleGrid, Table, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import moment from "moment/moment";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchJobList } from "../../actions/utilActions";
import type { IJobsResponseSchema } from "../../actions/utilActions.types";
import { JobsResponseSchema } from "../../actions/utilActions.types";
import { useJobsQuery } from "../../api_client/api";
import { useAppDispatch } from "../../store/store";
import { DeleteJobButton } from "./DeleteJobButton";
import { JobIndicator } from "./JobIndicator";
import { JobProgress } from "./JobProgress";

export function JobList() {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const matches = useMediaQuery("(min-width: 700px)");
  const [jobCount, setJobCount] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [jobs, setJobs] = useState<IJobsResponseSchema>();

  const { currentData, isLoading } = useJobsQuery({ page: activePage, pageSize }, { pollingInterval: 2000 });

  useEffect(() => {
    if (currentData) {
      const parsed = JobsResponseSchema.parse(currentData);
      setJobs(parsed);
    }
  }, [currentData]);

  useEffect(() => {
    if (jobs) {
      setJobCount(jobs.results.length);
    }
  }, [jobs]);

  return (
    <SimpleGrid cols={1} spacing="xl">
      <Title order={3}>
        {t("joblist.workerlogs")} {isLoading ? <Loader size="xs" /> : null}
      </Title>
      <Table striped highlightOnHover>
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
          {jobs?.results.map(job => {
            const {
              error,
              queued_at: queuedAt,
              started_at: startedAt,
              started_by: { username },
              finished_at: finishedAt,
              finished,
              result: {
                progress: { current, target },
              },
            } = job;

            return (
              <tr key={job.job_id}>
                <td>
                  <JobIndicator job={job} />
                </td>
                <td>{job.job_type_str}</td>
                <td>
                  <JobProgress target={target} current={current} error={error} finished={finished} />
                </td>
                {matches && <td>{moment(queuedAt).fromNow()}</td>}
                {matches && <td>{startedAt ? moment(startedAt).fromNow() : ""}</td>}

                {matches && (
                  <td>
                    {finished
                      ? // @ts-ignore
                        moment.duration(moment(finishedAt) - moment(startedAt)).humanize()
                      : startedAt
                      ? t("joblist.running")
                      : ""}
                  </td>
                )}
                {matches && <td>{username}</td>}
                <td>
                  <DeleteJobButton job={job} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Pagination
        page={activePage}
        total={Math.ceil(+jobCount.toFixed(1) / pageSize)}
        onChange={newPage => {
          // @ts-ignore
          setActivePage(newPage);
          dispatch(fetchJobList(newPage, pageSize));
        }}
      />
    </SimpleGrid>
  );
}
