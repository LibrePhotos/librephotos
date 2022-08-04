import {
  ActionIcon,
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
import { Adjustments, Edit, Plus, Trash } from "tabler-icons-react";

import { deleteAllAutoAlbum } from "../../actions/albumsActions";
import { deleteJob, fetchSiteSettings } from "../../actions/utilActions";
import { useFetchUserListQuery } from "../../api_client/api";
import { JobList } from "../../components/job/JobList";
import { ModalUserDelete } from "../../components/modals/ModalUserDelete";
import { ModalUserEdit } from "../../components/modals/ModalUserEdit";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { SiteSettings } from "./SiteSettings";

export const AdminPage = () => {
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const fetchingUserList = useAppSelector(state => state.util.fetchingUserList);
  const { t } = useTranslation();

  useEffect(() => {
    if (auth.access.is_admin) {
      fetchSiteSettings(dispatch);
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

      <UserTable />
      <JobList />
    </SimpleGrid>
  );
};

const UserTable = () => {
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState({});
  const [userToDelete, setUserToDelete] = useState({});
  const [createNewUser, setCreateNewUser] = useState(false);

  const { data: userList } = useFetchUserListQuery();

  const matches = useMediaQuery("(min-width: 700px)");
  const { t } = useTranslation();

  return (
    <>
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
          {userList && userList.results
            ? userList.results.map(user => (
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
                  {matches && <td>{moment(user.date_joined).fromNow()}</td>}
                </tr>
              ))
            : null}
          <tr>
            <td>
              <Button
                size="sm"
                color="green"
                leftIcon={<Plus />}
                onClick={() => {
                  setCreateNewUser(true);
                  setUserToEdit({});
                  setUserModalOpen(true);
                }}
              >
                {t("adminarea.addnewuser")}
              </Button>
            </td>
          </tr>
        </tbody>
      </Table>

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
    </>
  );
};
