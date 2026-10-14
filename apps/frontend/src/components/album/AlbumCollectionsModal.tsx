import { Button, Checkbox, Divider, Group, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useCreateAlbumCollectionMutation,
  useFetchAlbumCollectionsQuery,
  useSetUserAlbumCollectionsMutation,
} from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { AlbumCollectionNameForm } from "./AlbumCollectionNameForm";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  albumId: number | string;
  albumTitle: string;
  /** The album's collections when the dialog opens (its card, or the album page). */
  collectionIds: readonly number[];
}>;

/** Toggle `id` in `ids`, keeping the order the ids came in. */
function toggled(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id];
}

function Checklist({ albumId, collectionIds, onClose }: Omit<Props, "opened" | "albumTitle">) {
  const { t } = useTranslation();
  const collectionsQuery = useFetchAlbumCollectionsQuery();
  const listFailure = useListFailure(collectionsQuery);
  const setCollections = useSetUserAlbumCollectionsMutation();
  const createCollection = useCreateAlbumCollectionMutation({ reportsErrors: true });
  // The dialog's own copy: a tick shows at once and the next tick builds on it, while the album
  // list refetches behind it. The body unmounts on close, so every opening starts from the album.
  const [checked, setChecked] = useState<number[]>(() => [...collectionIds]);
  const collections = collectionsQuery.data ?? [];

  const save = (next: number[]) => {
    const before = checked;
    setChecked(next);
    // Only undoes the ticks: the QueryClient's toast reports the failure.
    setCollections.mutate({ albumId, collectionIds: next }, { onError: () => setChecked(before) });
  };

  const createAndFile = async (name: string) => {
    const created = await createCollection.mutateAsync(name);
    save([...checked, created.id]);
  };

  if (listFailure) return <ErrorState failure={listFailure} compact />;
  if (collectionsQuery.isLoading) return <PageLoader />;

  return (
    <Stack gap="sm">
      {collections.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("albumcollections.none")}
        </Text>
      ) : (
        <ScrollArea.Autosize mah={320} type="auto">
          <Stack gap="xs" role="group" aria-label={t("albumcollections.title")}>
            {collections.map(collection => (
              <Checkbox
                key={collection.id}
                label={collection.name}
                checked={checked.includes(collection.id)}
                onChange={() => save(toggled(checked, collection.id))}
              />
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
      <Divider />
      <AlbumCollectionNameForm
        existingNames={collections.map(collection => collection.name)}
        label={t("albumcollections.new")}
        submitLabel={t("albumcollections.add")}
        submitIcon={<IconPlus size={ICON_SIZE.inline} />}
        pending={createCollection.isPending}
        onSubmit={createAndFile}
        autoFocus={collections.length === 0}
      />
      <Text size="xs" c="dimmed">
        {t("albumcollections.savedastyoutick")}
      </Text>
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t("albumcollections.done")}
        </Button>
      </Group>
    </Stack>
  );
}

/** Which of the user's collections hold one album (#1009): a checklist saved on every tick. */
export function AlbumCollectionsModal({ opened, onClose, albumTitle, ...props }: Props) {
  const { t } = useTranslation();
  return (
    <Modal size="sm" opened={opened} onClose={onClose} title={t("albumcollections.dialogtitle", { title: albumTitle })}>
      <Checklist onClose={onClose} {...props} />
    </Modal>
  );
}
