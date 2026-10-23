import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api_client/api";
import { useAddLibraryFolderMutation } from "../../api_client/user/hooks/useLibraryFolders";
import { modalTitleStyles } from "../modals/modalTitleStyles";
import { DirectoryPicker } from "../setup/DirectoryPicker";
import { makeAddLibraryFolderSchema } from "./AddLibraryFolderModal.schema";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  userId: number;
  username: string;
}>;

/**
 * Admin: pick a folder on the server and add it to a user's library (#123). The server refuses one
 * that overlaps a folder of this or another user's library; its message shows under the field.
 */
export function AddLibraryFolderModal({ opened, onClose, userId, username }: Props) {
  const { t } = useTranslation();
  const [isPathValid, setIsPathValid] = useState(true);
  const addFolder = useAddLibraryFolderMutation(userId, { reportsErrors: true });
  const form = useForm({
    initialValues: { path: "" },
    validate: schemaResolver(makeAddLibraryFolderSchema(t, isPathValid), { sync: true }),
  });

  const close = () => {
    form.reset();
    onClose();
  };

  const submit = ({ path }: { path: string }) => {
    addFolder.mutate(path.trim(), {
      onSuccess: close,
      onError: error => {
        const message = error instanceof ApiError ? error.serverMessage : null;
        form.setFieldError("path", message ?? t("libraryfolders.addfailed"));
      },
    });
  };

  return (
    <Modal
      styles={modalTitleStyles}
      opened={opened}
      onClose={close}
      title={t("libraryfolders.addtitle", { username })}
      size="lg"
      centered
    >
      {/* The user dialog holds this one: its submit must not bubble (through the portal) into that form. */}
      <form
        onSubmit={event => {
          event.stopPropagation();
          form.onSubmit(submit)(event);
        }}
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {t("libraryfolders.addexplanation")}
          </Text>
          <DirectoryPicker
            name="library_folder"
            value={form.values.path}
            onChange={next => form.setFieldValue("path", next)}
            onValidityChange={setIsPathValid}
            label={
              <Text fw="bold" span>
                {t("libraryfolders.folder")}
              </Text>
            }
            missingPathError={t("modalscandirectoryedit.pathdoesnotexist")}
          />
          {form.errors.path && (
            <Text size="sm" c="red" role="alert">
              {form.errors.path}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {t("cancel")}
            </Button>
            <Button type="submit" loading={addFolder.isPending}>
              {t("libraryfolders.addconfirm")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
