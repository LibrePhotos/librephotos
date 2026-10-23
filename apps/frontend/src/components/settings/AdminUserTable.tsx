import type { ListUser } from "@librephotos/api-client";
import { ActionIcon, Button, Card, Flex, Group, Loader, Table, Text, Title, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconEdit as Edit, IconPlus as Plus, IconTrash as Trash } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { useIsDesktopLayout } from "../../hooks/useIsDesktopLayout";
import { parseInstant } from "../../util/dateUtils";
import { ModalUserDelete } from "../modals/ModalUserDelete";
import { ModalUserEdit } from "../modals/ModalUserEdit";
import classes from "./AdminUserTable.module.css";
import { ScanUserButton } from "./ScanUserButton";
import { SectionLink } from "./SettingsSection";

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

type RowProps = Readonly<{
  user: ListUser;
  wide: boolean;
  onEdit: (user: ListUser) => void;
  onDelete: (user: ListUser) => void;
}>;

function UserRow({ user, wide, onEdit, onDelete }: RowProps) {
  const { t } = useTranslation();
  const deleteLabel = user.is_superuser ? t("adminarea.cannotdeleteadmin") : t("delete");
  return (
    <Table.Tr>
      <Table.Td>{user.username}</Table.Td>
      <Table.Td>
        {/* Scan now sits next to the path it scans (#2037), so fixing a path and scanning it
            happen on one page. */}
        <Group gap={6} wrap="nowrap">
          <ScanDirectory path={user.scan_directory} />
          {user.scan_directory ? <ScanUserButton userId={user.id} username={user.username} /> : null}
        </Group>
      </Table.Td>
      {wide && <Table.Td>{user.photo_count}</Table.Td>}
      {wide && <Table.Td>{user.date_joined ? parseInstant(user.date_joined).toRelative() : null}</Table.Td>}
      <Table.Td>
        <Group gap={5} wrap="nowrap">
          <ActionIcon
            variant="transparent"
            color="blue"
            title={t("modify")}
            aria-label={t("modify")}
            onClick={() => onEdit(user)}
          >
            <Edit />
          </ActionIcon>
          <ActionIcon
            variant="transparent"
            color="red"
            disabled={user.is_superuser}
            title={deleteLabel}
            aria-label={deleteLabel}
            onClick={() => onDelete(user)}
          >
            <Trash />
          </ActionIcon>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

/** The Users card of the Admin Area: every account, its library folder, and its editor. */
export function AdminUserTable() {
  const { t } = useTranslation();
  const [userModalOpen, { open: openUserModal, close: closeUserModal }] = useDisclosure(false);
  const [deleteModalOpen, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);
  // Empty until a row is picked, and for a new user.
  const [userToEdit, setUserToEdit] = useState<Partial<ListUser>>({});
  const [userToDelete, setUserToDelete] = useState<Partial<ListUser>>({});
  const [createNewUser, setCreateNewUser] = useState(false);
  const { data: userList, isFetching } = useFetchUserListQuery();
  const matches = useIsDesktopLayout();

  const editUser = (user: Partial<ListUser>, createNew: boolean) => {
    setUserToEdit(user);
    setCreateNewUser(createNew);
    openUserModal();
  };

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
              <UserRow
                key={user.username}
                user={user}
                wide={matches}
                onEdit={row => editUser(row, false)}
                onDelete={row => {
                  setUserToDelete(row);
                  openDeleteModal();
                }}
              />
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Flex justify="flex-end" mt={10}>
        <Button size="sm" variant="outline" leftSection={<Plus />} onClick={() => editUser({}, true)}>
          {t("adminarea.addnewuser")}
        </Button>
      </Flex>

      <ModalUserEdit
        onRequestClose={closeUserModal}
        userToEdit={userToEdit}
        userList={userList ?? []}
        isOpen={userModalOpen}
        createNew={createNewUser}
      />
      <ModalUserDelete onRequestClose={closeDeleteModal} isOpen={deleteModalOpen} userToDelete={userToDelete} />
    </Card>
  );
}
