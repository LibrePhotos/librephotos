import { ActionIcon, Button, Card, Container, Flex, Group, Loader, Space, Stack, Table, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Adjustments, Edit, Plus, Trash } from "tabler-icons-react";

import { useDeleteAllAutoAlbumsMutation } from "../../api_client/albums/auto";
import { useFetchServerStatsQuery, useFetchUserListQuery } from "../../api_client/api";
import { JobList } from "../../components/job/JobList";
import { ModalUserDelete } from "../../components/modals/ModalUserDelete";
import { ModalUserEdit } from "../../components/modals/ModalUserEdit";
import { i18nResolvedLanguage } from "../../i18n";
import { useAppSelector } from "../../store/store";
import { SiteSettings } from "./SiteSettings";

function UserTable() {
  const { t } = useTranslation();
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState({});
  const [userToDelete, setUserToDelete] = useState({});
  const [createNewUser, setCreateNewUser] = useState(false);
  const { data: userList, isFetching } = useFetchUserListQuery();
  const matches = useMediaQuery("(min-width: 700px)");

  return (
    <Card shadow="md">
      <Title order={4} mb={16}>
        {t("adminarea.users")}
        {isFetching ? <Loader size="xs" /> : null}
      </Title>
      <Table striped highlightOnHover>
        <thead>
          <tr>
            <th>Add/Modify/Delete</th>
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
          {userList?.map(user => (
            <tr key={user.username}>
              <td>
                <span style={{ display: "flex" }}>
                  <ActionIcon
                    variant="transparent"
                    color="blue"
                    title={t("modify")}
                    onClick={() => {
                      setUserToEdit(user);
                      setCreateNewUser(false);
                      setUserModalOpen(true);
                    }}
                  >
                    <Edit />
                  </ActionIcon>

                  <ActionIcon
                    style={{ marginLeft: "5px" }}
                    variant="transparent"
                    color="red"
                    disabled={user.is_superuser}
                    title={user.is_superuser ? t("adminarea.cannotdeleteadmin") : t("delete")}
                    onClick={() => {
                      setUserToDelete(user);
                      setDeleteModalOpen(true);
                    }}
                  >
                    <Trash />
                  </ActionIcon>
                </span>
              </td>
              <td>{user.username}</td>
              <td>{user.scan_directory ? user.scan_directory : t("adminarea.notset")}</td>
              {matches && <td>{user.confidence ? user.confidence : t("adminarea.notset")}</td>}
              {matches && <td>{user.photo_count}</td>}
              {matches && <td>{DateTime.fromISO(user.date_joined).setLocale(i18nResolvedLanguage()).toRelative()}</td>}
            </tr>
          ))}
        </tbody>
      </Table>
      <Flex justify="flex-end" mt={10}>
        <Button
          size="sm"
          color="green"
          variant="outline"
          leftIcon={<Plus />}
          onClick={() => {
            setCreateNewUser(true);
            setUserToEdit({});
            setUserModalOpen(true);
          }}
        >
          {t("adminarea.addnewuser")}
        </Button>
      </Flex>

      <ModalUserEdit
        onRequestClose={() => {
          setUserModalOpen(false);
        }}
        userToEdit={userToEdit}
        userList={userList}
        isOpen={userModalOpen}
        createNew={createNewUser}
      />
      <ModalUserDelete
        onRequestClose={() => {
          setDeleteModalOpen(false);
        }}
        isOpen={deleteModalOpen}
        userToDelete={userToDelete}
      />
    </Card>
  );
}

function AdminTools() {
  const { t } = useTranslation();
  const { data: serverStats, isLoading } = useFetchServerStatsQuery();
  const [deleteAllAutoAlbums] = useDeleteAllAutoAlbumsMutation();

  const downloadFile = () => {
    // create file in browser
    const fileName = "serverstats";
    const json = JSON.stringify(serverStats, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const href = URL.createObjectURL(blob);

    // create "a" HTLM element with href to file
    const link = document.createElement("a");
    link.href = href;
    link.download = `${fileName}.json`;
    document.body.appendChild(link);
    link.click();

    // clean up "a" element & remove ObjectURL
    document.body.removeChild(link);
    URL.revokeObjectURL(href);
  };

  return (
    <Card shadow="md">
      <Stack>
        <Title order={4} mb={16}>
          {t("adminarea.admintools")}
        </Title>
        <Flex justify="space-between">
          <>{t("adminarea.deleteallautoalbums")}</>
          <Button onClick={() => deleteAllAutoAlbums()} variant="outline">
            {t("adminarea.delete")}
          </Button>
        </Flex>
        <Flex justify="space-between">
          <div>{t("adminarea.downloadserverstats")}</div>
          <Button loading={isLoading} onClick={() => downloadFile()}>
            {t("adminarea.download")}
          </Button>
        </Flex>
      </Stack>
    </Card>
  );
}

export function AdminPage() {
  const auth = useAppSelector(state => state.auth);
  const { t } = useTranslation();

  if (!auth.access.is_admin) {
    return <div>Unauthorized</div>;
  }

  return (
    <Container>
      <Stack>
        <Flex align="baseline" justify="space-between">
          <Group spacing="xs" sx={{ marginBottom: 20, marginTop: 40 }}>
            <Adjustments size={35} />
            <Title order={1}>{t("adminarea.header")}</Title>
          </Group>
        </Flex>

        <SiteSettings />

        <AdminTools />

        <UserTable />

        <JobList />

        <Space h="xl" />
      </Stack>
    </Container>
  );
}
