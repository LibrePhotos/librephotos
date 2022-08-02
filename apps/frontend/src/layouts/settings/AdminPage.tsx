import { Button, Group, Loader, SimpleGrid, Table, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import moment from "moment";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Adjustments, Edit } from "tabler-icons-react";

import { deleteAllAutoAlbum } from "../../actions/albumsActions";
import { fetchSiteSettings, fetchUserList } from "../../actions/utilActions";
import { JobList } from "../../components/job/JobList";
import { ModalScanDirectoryEdit } from "../../components/modals/ModalScanDirectoryEdit";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { SiteSettings } from "./SiteSettings";

export function AdminPage() {
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
            {matches && (
              <>
                <th>{t("adminarea.minimumconfidence")}</th>
                <th>{t("adminarea.photocount")}</th>
                <th>{t("adminarea.joined")}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {userList.map(user => (
            <tr key={user.username}>
              <td>{user.username}</td>
              <td>
                {
                  // TODO: Show an error when no scan directory is set
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
              {matches && (
                <>
                  <td>{user.confidence ? user.confidence : t("adminarea.notset")}</td>
                  <td>{user.photo_count}</td>
                  <td>{moment(user.date_joined).fromNow()}</td>
                </>
              )}
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
}
