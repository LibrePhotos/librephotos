import {
  Button,
  Center,
  Group,
  Loader,
  Pagination,
  Popover,
  Progress,
  SimpleGrid,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import moment from "moment";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Adjustments, Ban, Check, Clock, Edit, Refresh } from "tabler-icons-react";

import { deleteAllAutoAlbum } from "../../actions/albumsActions";
import { deleteJob, fetchJobList, fetchSiteSettings, fetchUserList } from "../../actions/utilActions";
import { ModalScanDirectoryEdit } from "../../components/modals/ModalScanDirectoryEdit";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { SiteSettings } from "./SiteSettings";

export const AdminPage = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState(null);

  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const { userList, fetchingUserList } = useAppSelector(state => state.util);
  const { t } = useTranslation();

  const matches = useMediaQuery("(min-width: 700px)");

  useEffect(() => {
    if (auth.access.is_admin) {
      fetchSiteSettings(dispatch);
      dispatch(fetchJobList());
      dispatch(fetchUserList());
    }
  }, [auth.access, dispatch]);

  if (!auth.access.is_admin) {
    return <div>Unauthorized</div>;
  }

  return (
    <SimpleGrid cols={1} spacing="xl">
      <Group spacing="xs">
        <Adjustments size={35} />
        <Title order={2}>{t("adminarea.header")}</Title>
      </Group>
      <Title order={3}>{t("adminarea.sitesettings")}</Title>
      <SiteSettings />
      <Title order={3}>{t("adminarea.admintools")}</Title>
      <Button onClick={() => dispatch(deleteAllAutoAlbum())}>{t("adminarea.deleteallautoalbums")}</Button>
      <Title order={3}>
        {t("adminarea.users")}
        {fetchingUserList ? <Loader size="xs" /> : null}
      </Title>
      <Table striped highlightOnHover>
        <thead>
          <tr>
            <th>{t("adminarea.username")}</th>
            <th>{t("adminarea.scandirectory")}</th>
            {matches && <th>{t("adminarea.minimumconfidence")}</th>}
            {matches && <th>{t("adminarea.photocount")}</th>}
            {matches && <th>{t("adminarea.joined")}</th>}
          </tr>
        </thead>
        <tbody>
          {userList.map(user => (
            <tr key={user.username}>
              <td>{user.username}</td>
              <td>
                {
                  //To-Do: Show a error when no scan directory is set
                }
                <Button
                  variant="subtle"
                  leftIcon={<Edit />}
                  onClick={() => {
                    setUserToEdit(user);
                    setModalOpen(true);
                  }}
                >
                  {user.scan_directory ? user.scan_directory : t("adminarea.notset")}
                </Button>
              </td>
              {matches && <td>{user.confidence ? user.confidence : t("adminarea.notset")}</td>}
              {matches && <td>{user.photo_count}</td>}
              {matches && <td>{moment(user.date_joined).fromNow()}</td>}
            </tr>
          ))}
        </tbody>
      </Table>
      <JobList />
      <ModalScanDirectoryEdit
        onRequestClose={() => {
          setModalOpen(false);
        }}
        userToEdit={userToEdit}
        isOpen={modalOpen}
      />
    </SimpleGrid>
  );
};

export const DeleteButton = job => {
  const [opened, setOpened] = useState(false);
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const id = job.job.id;
  const page = job.activePage;
  const pageSize = job.pageSize;

  return (
    <Popover
      opened={opened}
      position="top"
      placement="center"
      withArrow
      width={260}
      onClose={() => setOpened(false)}
      target={
        <Button
          onMouseEnter={() => setOpened(true)}
          onMouseLeave={() => setOpened(false)}
          onClick={() => {
            dispatch(deleteJob(id, page, pageSize));
          }}
          color="red"
        >
          {t("adminarea.remove")}
        </Button>
      }
    >
      <div style={{ display: "flex" }}>{t("joblist.removeexplanation")}</div>
    </Popover>
  );
};

export const JobList = () => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const { jobList, jobCount, fetchingJobList } = useAppSelector(state => state.util);
  const [page, setPage] = useState(1);
  const [activePage, setActivePage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const matches = useMediaQuery("(min-width: 700px)");
  const auth = useAppSelector(state => state.auth);
  //fetch job every two seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (auth.access.is_admin) {
        dispatch(fetchJobList(activePage, pageSize));
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [auth.access, activePage, pageSize, dispatch]);

  return (
    <SimpleGrid cols={1} spacing="xl">
      <Title order={3}>
        {t("joblist.workerlogs")} {fetchingJobList ? <Loader size="xs" /> : null}
      </Title>
      <Table striped highlightOnHover>
        <thead>
          <tr>
            <th> {t("joblist.status")}</th>
            <th> {t("joblist.jobtype")}</th>
            <th> {t("joblist.progress")}</th>
            {matches && <th> {t("joblist.queued")}</th>}
            {matches && <th> {t("joblist.started")}</th>}
            {matches && <th> {t("joblist.duration")}</th>}
            {matches && <th> {t("joblist.startedby")}</th>}
            <th> {t("joblist.delete")}</th>
          </tr>
        </thead>
        <tbody>
          {jobList.map(job => {
            const jobSuccess = job.finished && !job.failed;
            return (
              // error={job.failed} warning={!job.finished_at}
              <tr key={job.job_id}>
                <td>
                  {job.finished ? (
                    job.failed ? (
                      <Ban color="red" />
                    ) : (
                      <Check color="green" />
                    )
                  ) : job.started_at ? (
                    <Refresh color="yellow" />
                  ) : (
                    <Clock color="blue" />
                  )}
                </td>
                <td>{job.job_type_str}</td>
                <td>
                  {job.result.progress.target !== 0 && !job.finished ? (
                    <div>
                      <Progress
                        size={30}
                        value={(job.result.progress.current.toFixed(2) / job.result.progress.target) * 100}
                      ></Progress>
                      <Center>
                        {`${job.result.progress.current} ${t("joblist.itemsprocessed")} (${(
                          (job.result.progress.current.toFixed(2) / job.result.progress.target) *
                          100
                        ).toFixed(2)} %) `}
                      </Center>
                    </div>
                  ) : job.finished ? (
                    <div>
                      <Progress size={30} color={job.error ? "red" : "green"} value={100} />
                      <Center>{`${job.result.progress.current} ${t("joblist.itemsprocessed")} `}</Center>
                    </div>
                  ) : null}
                </td>
                {matches && <td>{moment(job.queued_at).fromNow()}</td>}
                {matches && <td>{job.started_at ? moment(job.started_at).fromNow() : ""}</td>}

                {matches && (
                  <td>
                    {job.finished
                      ? // @ts-ignore
                        moment.duration(moment(job.finished_at) - moment(job.started_at)).humanize()
                      : job.started_at
                      ? t("joblist.running")
                      : ""}
                  </td>
                )}
                {matches && <td>{job.started_by.username}</td>}
                <td>
                  <DeleteButton job={job}></DeleteButton>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Pagination
        page={activePage}
        total={Math.ceil(jobCount.toFixed(1) / pageSize)}
        onChange={newPage => {
          //@ts-ignore
          setActivePage(newPage);
          dispatch(fetchJobList(newPage, pageSize));
        }}
      />
    </SimpleGrid>
  );
};
