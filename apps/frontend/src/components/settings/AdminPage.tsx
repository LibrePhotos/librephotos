import type { ListUser } from "@librephotos/api-client";
import {
  ActionIcon,
  Button,
  Card,
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
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAdjustments as Adjustments,
  IconEdit as Edit,
  IconLock as Lock,
  IconPlus as Plus,
  IconTrash as Trash,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeleteAllAutoAlbumsMutation } from "../../api_client/albums/hooks";
import { useUpgradeTasksQuery } from "../../api_client/jobs/hooks/useUpgradeTasks";
import { useFetchServerStatsQuery } from "../../api_client/server/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useIsDesktopLayout } from "../../hooks/useIsDesktopLayout";
import { parseInstant } from "../../util/dateUtils";
import { EmptyState } from "../common/EmptyState";
import { PageLoader } from "../common/PageLoader";
import { JobList } from "../job/JobList";
import { ModalUserDelete } from "../modals/ModalUserDelete";
import { ModalUserEdit } from "../modals/ModalUserEdit";
import { PageHeader } from "../PageHeader";
import classes from "./AdminPage.module.css";
import { EmailSettings } from "./EmailSettings";
import { FeaturesCard } from "./FeaturesCard";
import { FinishUpgradeCard } from "./FinishUpgradeCard";
import { LookUpPlacesTool } from "./LookUpPlacesTool";
import { ADMIN_SECTIONS } from "./sectionIds";
import { SectionNav } from "./SectionNav";
import { ServerLogsCard } from "./ServerLogsCard";
import { ServiceList } from "./ServiceList";
import { SectionLink, SettingsSection } from "./SettingsSection";
import { SiteSettings } from "./SiteSettings";
import { StripThumbnailMetadataTool } from "./StripThumbnailMetadataTool";

/** The scan directory on one line, cut at the start so its last folders stay in view. */
function ScanDirectory({ path }: Readonly<{ path: string | null | undefined }>) {
  const { t } = useTranslation();
  if (!path) {
    return (
      <Text size="sm" c="dimmed">
        {t("adminarea.notset")}
      </Text>
    );
  }
  return (
    // Focus and a long press open it too, so the full path is not only for mouse users.
    <Tooltip
      label={path}
      events={{ hover: true, focus: true, touch: true }}
      multiline
      maw={480}
      classNames={{ tooltip: classes.pathTooltip }}
    >
      <Text size="sm" truncate="start" className={classes.scanDirectory} tabIndex={0}>
        {/* Truncating at the start sets the text right-to-left; the path itself stays left-to-right,
            or the slash of "/mnt/..." shows at its end. */}
        <span dir="ltr">{path}</span>
      </Text>
    </Tooltip>
  );
}

function UserTable() {
  const { t } = useTranslation();
  const [userModalOpen, { open: openUserModal, close: closeUserModal }] = useDisclosure(false);
  const [deleteModalOpen, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);
  // Empty until a row is picked, and for a new user.
  const [userToEdit, setUserToEdit] = useState<Partial<ListUser>>({});
  const [userToDelete, setUserToDelete] = useState<Partial<ListUser>>({});
  const [createNewUser, setCreateNewUser] = useState(false);
  const { data: userList, isFetching } = useFetchUserListQuery();
  const matches = useIsDesktopLayout();

  return (
    <Card shadow="md">
      <Group gap="xs" mb={16}>
        <Title order={4}>
          {t("adminarea.users")}
          <SectionLink />
        </Title>
        {isFetching ? <Loader size="xs" /> : null}
      </Group>
      {/* Scrolls sideways on a phone instead of cutting the columns off at the card edge. */}
      <Table.ScrollContainer minWidth={300} type="native">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("adminarea.username")}</Table.Th>
              <Table.Th>{t("adminarea.scandirectory")}</Table.Th>
              {matches && (
                <>
                  <Table.Th>{t("adminarea.photocount")}</Table.Th>
                  <Table.Th>{t("adminarea.joined")}</Table.Th>
                </>
              )}
              {/* Last, as in the worker jobs table. */}
              <Table.Th>{t("adminarea.actions")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {userList?.map(user => (
              <Table.Tr key={user.username}>
                <Table.Td>{user.username}</Table.Td>
                <Table.Td>
                  <ScanDirectory path={user.scan_directory} />
                </Table.Td>
                {matches && <Table.Td>{user.photo_count}</Table.Td>}
                {matches && (
                  <Table.Td>{user.date_joined ? parseInstant(user.date_joined).toRelative() : null}</Table.Td>
                )}
                <Table.Td>
                  <Group gap={5} wrap="nowrap">
                    <ActionIcon
                      variant="transparent"
                      color="blue"
                      title={t("modify")}
                      aria-label={t("modify")}
                      onClick={() => {
                        setUserToEdit(user);
                        setCreateNewUser(false);
                        openUserModal();
                      }}
                    >
                      <Edit />
                    </ActionIcon>

                    <ActionIcon
                      variant="transparent"
                      color="red"
                      disabled={user.is_superuser}
                      title={user.is_superuser ? t("adminarea.cannotdeleteadmin") : t("delete")}
                      aria-label={user.is_superuser ? t("adminarea.cannotdeleteadmin") : t("delete")}
                      onClick={() => {
                        setUserToDelete(user);
                        openDeleteModal();
                      }}
                    >
                      <Trash />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Flex justify="flex-end" mt={10}>
        <Button
          size="sm"
          variant="outline"
          leftSection={<Plus />}
          onClick={() => {
            setCreateNewUser(true);
            setUserToEdit({});
            openUserModal();
          }}
        >
          {t("adminarea.addnewuser")}
        </Button>
      </Flex>

      <ModalUserEdit
        onRequestClose={() => {
          closeUserModal();
        }}
        userToEdit={userToEdit}
        userList={userList ?? []}
        isOpen={userModalOpen}
        createNew={createNewUser}
      />
      <ModalUserDelete
        onRequestClose={() => {
          closeDeleteModal();
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
        <Title order={4}>
          {t("adminarea.admintools")}
          <SectionLink />
        </Title>
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
        <StripThumbnailMetadataTool buttonWidth={ADMIN_TOOL_MIN_WIDTH} />
        <LookUpPlacesTool buttonWidth={ADMIN_TOOL_MIN_WIDTH} />
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
  // The card heads the page while an update left something to do (#2322).
  const upgradeTasks = useUpgradeTasksQuery({ enabled: currentUser?.is_superuser === true }).data?.tasks ?? [];

  if (isPending) {
    return <PageLoader />;
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

  const sections = [
    ...(upgradeTasks.length ? [{ id: ADMIN_SECTIONS.upgrade, label: t("upgradetasks.header") }] : []),
    { id: ADMIN_SECTIONS.site, label: t("adminarea.sitesettings") },
    { id: ADMIN_SECTIONS.features, label: t("sitesettings.features_header") },
    { id: ADMIN_SECTIONS.email, label: t("emailsettings.header") },
    { id: ADMIN_SECTIONS.tools, label: t("adminarea.admintools") },
    { id: ADMIN_SECTIONS.logs, label: t("adminarea.serverlogs") },
    { id: ADMIN_SECTIONS.services, label: t("services.header") },
    { id: ADMIN_SECTIONS.users, label: t("adminarea.users") },
    { id: ADMIN_SECTIONS.jobs, label: t("joblist.workerlogs") },
  ];

  return (
    <Container size="lg">
      {/* Outside the Stack, so the first card starts where it does on the other settings pages. */}
      <PageHeader icon={Adjustments} title={t("adminarea.header")} />
      <SectionNav sections={sections}>
        <Stack>
          {upgradeTasks.length ? (
            <SettingsSection id={ADMIN_SECTIONS.upgrade}>
              <FinishUpgradeCard tasks={upgradeTasks} />
            </SettingsSection>
          ) : null}
          <SettingsSection id={ADMIN_SECTIONS.site}>
            <SiteSettings />
          </SettingsSection>
          <SettingsSection id={ADMIN_SECTIONS.features}>
            <FeaturesCard />
          </SettingsSection>
          {/* Anchors itself (admin-email). */}
          <EmailSettings />
          <SettingsSection id={ADMIN_SECTIONS.tools}>
            <AdminTools />
          </SettingsSection>
          <SettingsSection id={ADMIN_SECTIONS.logs}>
            <ServerLogsCard />
          </SettingsSection>
          <SettingsSection id={ADMIN_SECTIONS.services}>
            <ServiceList />
          </SettingsSection>
          <SettingsSection id={ADMIN_SECTIONS.users}>
            <UserTable />
          </SettingsSection>
          <SettingsSection id={ADMIN_SECTIONS.jobs}>
            <JobList />
          </SettingsSection>
          <Space h="xl" />
        </Stack>
      </SectionNav>
    </Container>
  );
}
