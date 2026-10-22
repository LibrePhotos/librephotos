import type { LibraryFolderEntry } from "@librephotos/api-client";
import { Button, Checkbox, Group, Modal, Stack, Text } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTrashPhotosOutsideLibraryMutation } from "../../api_client/jobs/hooks/useTrashPhotosOutsideLibraryMutation";
import { useRemoveLibraryFolderMutation } from "../../api_client/user/hooks/useLibraryFolders";
import { modalTitleStyles } from "../modals/modalTitleStyles";
import classes from "./LibraryFolderRow.module.css";

type Props = Readonly<{
  opened: boolean;
  /** The folder to remove. */
  folder: LibraryFolderEntry | null;
  onClose: () => void;
  userId: number;
  username: string;
}>;

/**
 * Admin: remove a further folder from a user's library (#123). Its files stay on disk and its
 * photos stay the user's, outside the library; the admin may move them to the user's trash, as
 * after a change of the scan directory (#2036).
 */
export function RemoveLibraryFolderModal({ opened, folder, onClose, userId, username }: Props) {
  const { t } = useTranslation();
  const [trashPhotos, setTrashPhotos] = useState(false);
  const removeFolder = useRemoveLibraryFolderMutation(userId);
  const trashOutside = useTrashPhotosOutsideLibraryMutation();
  const count = folder?.photo_count ?? 0;

  const close = () => {
    setTrashPhotos(false);
    onClose();
  };

  const remove = () => {
    const folderId = folder?.id;
    if (folderId === undefined || folderId === null) return;
    removeFolder.mutate(folderId, {
      onSuccess: () => {
        if (trashPhotos && count) trashOutside.mutate({ userId, username, count });
        close();
      },
    });
  };

  return (
    <Modal
      styles={modalTitleStyles}
      opened={opened}
      onClose={close}
      title={t("libraryfolders.removetitle")}
      centered
      closeOnClickOutside={!removeFolder.isPending}
      closeOnEscape={!removeFolder.isPending}
    >
      <Stack gap="sm">
        <Text size="sm" ff="monospace" className={classes.path}>
          {folder?.path}
        </Text>
        <Text size="sm">{t("libraryfolders.removemessage", { username })}</Text>
        {count > 0 && (
          <Checkbox
            checked={trashPhotos}
            onChange={event => setTrashPhotos(event.currentTarget.checked)}
            label={t("libraryfolders.removetrash", { count, username })}
            description={t("scandirectorychange.trashdescription")}
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={close} disabled={removeFolder.isPending} data-autofocus>
            {t("cancel")}
          </Button>
          <Button color="red" onClick={remove} loading={removeFolder.isPending}>
            {t("libraryfolders.removeconfirm")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
