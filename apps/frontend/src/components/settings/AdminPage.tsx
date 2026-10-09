import {
  ActionIcon,
  Button,
  Card,
  Center,
  Container,
  Flex,
  Group,
  Loader,
  Modal,
  Space,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import {
  IconAdjustments as Adjustments,
  IconEdit as Edit,
  IconLock as Lock,
  IconPlus as Plus,
  IconTrash as Trash,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeleteAllAutoAlbumsMutation } from "../../api_client/albums/hooks";
import { useFetchServerStatsQuery } from "../../api_client/server/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { i18nResolvedLanguage } from "../../i18n";
import { EmptyState } from "../common/EmptyState";
import { JobList } from "../job/JobList";
import { ModalUserDelete } from "../modals/ModalUserDelete";
import { ModalUserEdit } from "../modals/ModalUserEdit";
import { ServerLogsCard } from "./ServerLogsCard";
import { ServiceList } from "./ServiceList";
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
      <Group gap="xs" mb={16}>
        <Title order={4}>{t("adminarea.users")}</Title>
        {isFetching ? <Loader size="xs" /> : null}
      </Group>
      {/* Scrolls sideways on a phone instead of cutting the columns off at the card edge. */}
      <Table.ScrollContainer minWidth={300} type="native">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("adminarea.actions")}</Table.Th>
              <Table.Th>{t("adminarea.username")}</Table.Th>
              <Table.Th>{t("adminarea.scandirectory")}</Table.Th>
              {matches && (
                <>
                  <Table.Th>{t("adminarea.minimumconfidence")}</Table.Th>
                  <Table.Th>{t("adminarea.photocount")}</Table.Th>
                  <Table.Th>{t("adminarea.joined")}</Table.Th>
                </>
              )}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {userList?.map(user => (
              <Table.Tr key={user.username}>
                <Table.Td>
                  <span style={{ display: "flex" }}>
                    <ActionIcon
                      variant="transparent"
                      color="blue"
                      title={t("modify")}
                      aria-label={t("modify")}
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
                      aria-label={user.is_superuser ? t("adminarea.cannotdeleteadmin") : t("delete")}
                      onClick={() => {
                        setUserToDelete(user);
                        setDeleteModalOpen(true);
                      }}
                    >
                      <Trash />
                    </ActionIcon>
                  </span>
                </Table.Td>
                <Table.Td>{user.username}</Table.Td>
                {/* Long paths wrap anywhere instead of widening the table. */}
                <Table.Td style={{ overflowWrap: "anywhere" }}>
                  {user.scan_directory ? user.scan_directory : t("adminarea.notset")}
                </Table.Td>
                {matches && <Table.Td>{user.confidence ? user.confidence : t("adminarea.notset")}</Table.Td>}
                {matches && <Table.Td>{user.photo_count}</Table.Td>}
                {matches && (
                  <Table.Td>
                    {DateTime.fromISO(user.date_joined).setLocale(i18nResolvedLanguage()).toRelative()}
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Flex justify="flex-end" mt={10}>
        <Button
          size="sm"
          color="green"
          variant="outline"
          leftSection={<Plus />}
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

const ADMIN_TOOL_MIN_WIDTH = 120;

function AdminTools() {
  const { t } = useTranslation();
  const { data: serverStats, isLoading } = useFetchServerStatsQuery();
  const { mutate: deleteAllAutoAlbums, isPending } = useDeleteAllAutoAlbumsMutation();
  // Deleting drops every event album of this admin together with its favourite and sharing
  // state, which regenerating cannot bring back, so ask first.
  const [confirmOpen, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

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
        <Title order={4}>{t("adminarea.admintools")}</Title>
        <Flex justify="space-between" align="center" gap="md">
          <Text>{t("adminarea.deleteallautoalbums")}</Text>
          <Button
            color="red"
            variant="outline"
            leftSection={<Trash size={16} />}
            miw={ADMIN_TOOL_MIN_WIDTH}
            loading={isPending}
            onClick={openConfirm}
          >
            {t("adminarea.delete")}
          </Button>
        </Flex>
        <Flex justify="space-between" align="center" gap="md">
          <Text>{t("adminarea.downloadserverstats")}</Text>
          <Button miw={ADMIN_TOOL_MIN_WIDTH} loading={isLoading} onClick={() => downloadFile()}>
            {t("adminarea.download")}
          </Button>
        </Flex>
      </Stack>
      <Modal
        opened={confirmOpen}
        onClose={closeConfirm}
        centered
        // The modal title is already an h2; a span keeps the heading look without nesting headings.
        title={
          <Text component="span" fw={700} size="lg">
            {t("adminarea.deleteallautoalbums")}
          </Text>
        }
      >
        <Stack>
          <Text size="sm">{t("adminarea.deleteallautoalbumsexplanation")}</Text>
          <Text size="sm" c="red">
            {t("adminarea.cannotbeundone")}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeConfirm}>
              {t("cancel")}
            </Button>
            <Button
              color="red"
              loading={isPending}
              onClick={() => deleteAllAutoAlbums(undefined, { onSettled: closeConfirm })}
            >
              {t("adminarea.delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

export function AdminPage() {
  // isPending, not isLoading: the query stays disabled until the access token resolves, and a
  // disabled query is not "loading", which used to flash the unauthorized state for admins.
  const { data: currentUser, isPending } = useCurrentUserSelfDetailsQuery();
  const { t } = useTranslation();

  if (isPending) {
    return (
      <Center py={80}>
        <Loader />
      </Center>
    );
  }

  if (!currentUser?.is_superuser) {
    return (
      <EmptyState
        icon={<Lock size={40} />}
        title={t("adminarea.unauthorized")}
        description={t("adminarea.unauthorizeddescription")}
        actionLabel={t("publicalbum.goHome")}
        actionLink="/"
      />
    );
  }

  return (
    <Container>
      {/* Outside the Stack, so the first card starts where it does on the other settings pages. */}
      <Group gap="xs" mt={{ base: 20, sm: 40 }} mb={{ base: 10, sm: 20 }}>
        <Adjustments size={35} />
        <Title order={1}>{t("adminarea.header")}</Title>
      </Group>
      <Stack>
        <SiteSettings />

        <AdminTools />

        <ServerLogsCard />

        <ServiceList />

        <UserTable />

        <JobList />

        <Space h="xl" />
      </Stack>
    </Container>
  );
}
