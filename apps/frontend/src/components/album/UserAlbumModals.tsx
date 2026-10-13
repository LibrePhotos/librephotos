import { Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDeleteUserAlbumMutation, useRenameUserAlbumMutation } from "../../api_client/albums/hooks";
import { MutationErrorAlert } from "../common/MutationErrorAlert";
import { makeAlbumRenameSchema } from "./UserAlbumModals.schema";

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

function RenameForm({ onClose, albumId, albumTitle, existingTitles }: Omit<RenameProps, "opened">) {
  const { t } = useTranslation();
  // The dialog shows a failure itself and stays open for another try
  const renameUserAlbum = useRenameUserAlbumMutation({ reportsErrors: true });
  // Lives inside the modal body, which Mantine unmounts on close, so every
  // opening starts empty instead of carrying over the previous rename.
  const form = useForm({
    initialValues: { title: "" },
    validate: schemaResolver(makeAlbumRenameSchema(t, existingTitles), { sync: true }),
    validateInputOnChange: ["title"],
    transformValues: ({ title }) => ({ title: title.trim() }),
  });

  return (
    <form
      onSubmit={form.onSubmit(({ title }) => {
        renameUserAlbum.mutate({ id: albumId, title: albumTitle, newTitle: title }, { onSuccess: onClose });
      })}
    >
      <Stack>
        <TextInput
          data-autofocus
          label={albumTitle}
          placeholder={t("useralbum.albumplaceholder")}
          {...form.getInputProps("title")}
        />
        {renameUserAlbum.isError && (
          <MutationErrorAlert title={t("useralbum.renamefailed")} error={renameUserAlbum.error} />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={!form.isValid()} loading={renameUserAlbum.isPending}>
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
  const deleteUserAlbum = useDeleteUserAlbumMutation({ reportsErrors: true });
  return (
    <Modal opened={opened} onClose={onClose} title={t("delete")}>
      <Stack>
        <Text>{t("deletealbumexplanation")}</Text>
        {deleteUserAlbum.isError && (
          <MutationErrorAlert title={t("useralbum.deletefailed")} error={deleteUserAlbum.error} />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            color="red"
            loading={deleteUserAlbum.isPending}
            onClick={() => deleteUserAlbum.mutate({ id: albumId, albumTitle }, { onSuccess: onClose })}
          >
            {t("confirm")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
