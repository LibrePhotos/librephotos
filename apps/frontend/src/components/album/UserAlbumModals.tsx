import { Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeleteUserAlbumMutation, useRenameUserAlbumMutation } from "../../api_client/albums/hooks";

type AlbumModalProps = Readonly<{
  opened: boolean;
  onClose: () => void;
  albumId: string;
  albumTitle: string;
}>;

type RenameProps = AlbumModalProps &
  Readonly<{
    /** Titles already taken; a rename onto one of them is refused. */
    existingTitles: string[];
  }>;

const normalizeTitle = (title: string) => title.toLowerCase().trim();

function RenameForm({ onClose, albumId, albumTitle, existingTitles }: Omit<RenameProps, "opened">) {
  const { t } = useTranslation();
  const renameUserAlbum = useRenameUserAlbumMutation();
  // Lives inside the modal body, which Mantine unmounts on close, so every
  // opening starts empty instead of carrying over the previous rename.
  const [newTitle, setNewTitle] = useState("");
  const trimmed = newTitle.trim();
  const taken = trimmed !== "" && existingTitles.some(title => normalizeTitle(title) === normalizeTitle(trimmed));

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        if (!trimmed || taken) return;
        renameUserAlbum.mutate({ id: albumId, title: albumTitle, newTitle: trimmed });
        onClose();
      }}
    >
      <Stack>
        <TextInput
          data-autofocus
          label={albumTitle}
          value={newTitle}
          error={taken ? t("useralbum.albumalreadyexists", { name: trimmed }) : undefined}
          onChange={event => setNewTitle(event.currentTarget.value)}
          placeholder={t("useralbum.albumplaceholder")}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" color="green" disabled={!trimmed || taken}>
            {t("rename")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** The rename dialog of the album hub and My Albums, so both behave the same. */
export function RenameUserAlbumModal({ opened, ...props }: RenameProps) {
  const { t } = useTranslation();
  return (
    <Modal size="sm" opened={opened} onClose={props.onClose} title={t("useralbum.renamealbum")}>
      <RenameForm {...props} />
    </Modal>
  );
}

export function DeleteUserAlbumModal({ opened, onClose, albumId, albumTitle }: AlbumModalProps) {
  const { t } = useTranslation();
  const deleteUserAlbum = useDeleteUserAlbumMutation();
  return (
    <Modal opened={opened} onClose={onClose} title={t("delete")}>
      <Stack>
        <Text>{t("deletealbumexplanation")}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            color="red"
            onClick={() => {
              deleteUserAlbum.mutate({ id: albumId, albumTitle });
              onClose();
            }}
          >
            {t("confirm")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
