import type { AlbumCollection } from "@librephotos/api-client";
import { ActionIcon, Button, Divider, Group, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useCreateAlbumCollectionMutation,
  useDeleteAlbumCollectionMutation,
  useFetchAlbumCollectionsQuery,
  useRenameAlbumCollectionMutation,
} from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { ConfirmModal } from "../modals/ConfirmModal";
import { AlbumCollectionNameForm } from "./AlbumCollectionNameForm";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** How many of My Albums each collection holds. */
  counts: ReadonlyMap<number, number>;
}>;

type RowProps = Readonly<{
  collection: AlbumCollection;
  count: number;
  otherNames: string[];
  editing: boolean;
  onEdit: (editing: boolean) => void;
  onDelete: () => void;
}>;

function CollectionRow({ collection, count, otherNames, editing, onEdit, onDelete }: RowProps) {
  const { t } = useTranslation();
  const rename = useRenameAlbumCollectionMutation({ reportsErrors: true });

  if (editing) {
    return (
      <AlbumCollectionNameForm
        existingNames={otherNames}
        initialName={collection.name}
        label={t("albumcollections.rename", { name: collection.name })}
        submitLabel={t("rename")}
        pending={rename.isPending}
        onSubmit={newName =>
          rename.mutateAsync({ id: collection.id, name: collection.name, newName }).then(() => onEdit(false))
        }
        onCancel={() => onEdit(false)}
        autoFocus
      />
    );
  }

  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="sm" fw={500} flex={1} lineClamp={1} title={collection.name}>
        {collection.name}
      </Text>
      <Text size="xs" c="dimmed">
        {t("useralbum.numberof", { count })}
      </Text>
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label={t("albumcollections.rename", { name: collection.name })}
        onClick={() => onEdit(true)}
      >
        <IconEdit size={ICON_SIZE.inline} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="red"
        aria-label={t("albumcollections.delete", { name: collection.name })}
        onClick={onDelete}
      >
        <IconTrash size={ICON_SIZE.inline} />
      </ActionIcon>
    </Group>
  );
}

type ListProps = Omit<Props, "opened"> & Readonly<{ onDelete: (collection: AlbumCollection) => void }>;

function CollectionList({ counts, onClose, onDelete }: ListProps) {
  const { t } = useTranslation();
  const collectionsQuery = useFetchAlbumCollectionsQuery();
  const listFailure = useListFailure(collectionsQuery);
  const create = useCreateAlbumCollectionMutation({ reportsErrors: true });
  const [editingId, setEditingId] = useState<number>();
  const collections = collectionsQuery.data ?? [];
  const names = collections.map(collection => collection.name);

  if (listFailure) return <ErrorState failure={listFailure} compact />;
  if (collectionsQuery.isLoading) return <PageLoader />;

  return (
    <Stack gap="sm">
      {collections.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("albumcollections.none")}
        </Text>
      ) : (
        <ScrollArea.Autosize mah={360} type="auto">
          <Stack gap={4}>
            {collections.map(collection => (
              <CollectionRow
                key={collection.id}
                collection={collection}
                count={counts.get(collection.id) ?? 0}
                otherNames={names.filter(name => name !== collection.name)}
                editing={editingId === collection.id}
                onEdit={editing => setEditingId(editing ? collection.id : undefined)}
                onDelete={() => onDelete(collection)}
              />
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
      <Divider />
      <AlbumCollectionNameForm
        existingNames={names}
        label={t("albumcollections.new")}
        submitLabel={t("albumcollections.add")}
        submitIcon={<IconPlus size={ICON_SIZE.inline} />}
        pending={create.isPending}
        onSubmit={name => create.mutateAsync(name)}
        autoFocus={collections.length === 0}
      />
      <Text size="xs" c="dimmed">
        {t("albumcollections.explanation")}
      </Text>
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t("albumcollections.done")}
        </Button>
      </Group>
    </Stack>
  );
}

/** Rename and delete album collections, and add new ones (#1009). */
export function ManageAlbumCollectionsModal({ opened, onClose, counts }: Props) {
  const { t } = useTranslation();
  const remove = useDeleteAlbumCollectionMutation();
  const [toDelete, setToDelete] = useState<AlbumCollection>();
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
        title={t("albumcollections.managetitle")}
      >
        <CollectionList
          counts={counts}
          onClose={onClose}
          onDelete={collection => {
            setToDelete(collection);
            confirm.open();
          }}
        />
      </Modal>
      <ConfirmModal
        opened={confirmOpened}
        onClose={confirm.close}
        title={t("albumcollections.deletetitle", { name })}
        message={t("albumcollections.deletemessage", { name })}
        confirmLabel={t("albumcollections.deleteconfirm")}
        loading={remove.isPending}
        onConfirm={() => {
          if (toDelete) remove.mutate({ id: toDelete.id, name }, { onSettled: confirm.close });
        }}
      />
    </>
  );
}
