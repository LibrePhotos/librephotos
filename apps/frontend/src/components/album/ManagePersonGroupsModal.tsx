import type { PersonGroup } from "@librephotos/api-client";
import { ActionIcon, Button, Divider, Group, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useCreatePersonGroupMutation,
  useDeletePersonGroupMutation,
  useFetchPersonGroupsQuery,
  useRenamePersonGroupMutation,
} from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { ConfirmModal } from "../modals/ConfirmModal";
import { PersonGroupNameForm } from "./PersonGroupNameForm";

type Props = Readonly<{ opened: boolean; onClose: () => void }>;

type RowProps = Readonly<{
  group: PersonGroup;
  otherNames: string[];
  editing: boolean;
  onEdit: (editing: boolean) => void;
  onDelete: () => void;
}>;

function GroupRow({ group, otherNames, editing, onEdit, onDelete }: RowProps) {
  const { t } = useTranslation();
  const rename = useRenamePersonGroupMutation({ reportsErrors: true });

  if (editing) {
    return (
      <PersonGroupNameForm
        existingNames={otherNames}
        initialName={group.name}
        label={t("persongroups.rename", { name: group.name })}
        submitLabel={t("rename")}
        pending={rename.isPending}
        onSubmit={newName => rename.mutateAsync({ id: group.id, name: group.name, newName }).then(() => onEdit(false))}
        onCancel={() => onEdit(false)}
        autoFocus
      />
    );
  }

  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="sm" fw={500} flex={1} lineClamp={1} title={group.name}>
        {group.name}
      </Text>
      <Text size="xs" c="dimmed">
        {t("personalbum.numberofpeople", { count: group.person_count })}
      </Text>
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label={t("persongroups.rename", { name: group.name })}
        onClick={() => onEdit(true)}
      >
        <IconEdit size={ICON_SIZE.inline} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="red"
        aria-label={t("persongroups.delete", { name: group.name })}
        onClick={onDelete}
      >
        <IconTrash size={ICON_SIZE.inline} />
      </ActionIcon>
    </Group>
  );
}

type ListProps = Readonly<{ onClose: () => void; onDelete: (group: PersonGroup) => void }>;

function GroupList({ onClose, onDelete }: ListProps) {
  const { t } = useTranslation();
  const groupsQuery = useFetchPersonGroupsQuery();
  const listFailure = useListFailure(groupsQuery);
  const create = useCreatePersonGroupMutation({ reportsErrors: true });
  const [editingId, setEditingId] = useState<number>();
  const groups = groupsQuery.data ?? [];
  const names = groups.map(group => group.name);

  if (listFailure) return <ErrorState failure={listFailure} compact />;
  if (groupsQuery.isLoading) return <PageLoader />;

  return (
    <Stack gap="sm">
      {groups.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("persongroups.none")}
        </Text>
      ) : (
        <ScrollArea.Autosize mah={360} type="auto">
          <Stack gap={4}>
            {groups.map(group => (
              <GroupRow
                key={group.id}
                group={group}
                otherNames={names.filter(name => name !== group.name)}
                editing={editingId === group.id}
                onEdit={editing => setEditingId(editing ? group.id : undefined)}
                onDelete={() => onDelete(group)}
              />
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
      <Divider />
      <PersonGroupNameForm
        existingNames={names}
        label={t("persongroups.new")}
        submitLabel={t("persongroups.add")}
        submitIcon={<IconPlus size={ICON_SIZE.inline} />}
        pending={create.isPending}
        onSubmit={name => create.mutateAsync(name)}
        autoFocus={groups.length === 0}
      />
      <Text size="xs" c="dimmed">
        {t("persongroups.explanation")}
      </Text>
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t("persongroups.done")}
        </Button>
      </Group>
    </Stack>
  );
}

/** Rename and delete the user's groups of people, and add new ones (#1126). */
export function ManagePersonGroupsModal({ opened, onClose }: Props) {
  const { t } = useTranslation();
  const remove = useDeletePersonGroupMutation();
  const [toDelete, setToDelete] = useState<PersonGroup>();
  const [confirmOpened, confirm] = useDisclosure(false);
  const name = toDelete?.name ?? "";

  return (
    <>
      {/* Escape closes only the confirmation while it is open */}
      <Modal
        size="md"
        opened={opened}
        onClose={onClose}
        closeOnEscape={!confirmOpened}
        title={t("persongroups.managetitle")}
      >
        <GroupList
          onClose={onClose}
          onDelete={group => {
            setToDelete(group);
            confirm.open();
          }}
        />
      </Modal>
      <ConfirmModal
        opened={confirmOpened}
        onClose={confirm.close}
        title={t("persongroups.deletetitle", { name })}
        message={t("persongroups.deletemessage", { name })}
        confirmLabel={t("persongroups.deleteconfirm")}
        loading={remove.isPending}
        onConfirm={() => {
          if (toDelete) remove.mutate({ id: toDelete.id, name }, { onSettled: confirm.close });
        }}
      />
    </>
  );
}
