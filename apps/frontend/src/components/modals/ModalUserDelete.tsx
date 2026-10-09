import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { IconTrash as Trash } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api_client/api";
import { useDeleteUserMutation } from "../../api_client/user/hooks";
import { notification } from "../../service/notifications";
import { modalTitleStyles } from "./modalTitleStyles";

type Props = Readonly<{
  isOpen: boolean;
  userToDelete: any;
  onRequestClose: () => void;
}>;

export function ModalUserDelete(props: Props) {
  const { isOpen, onRequestClose, userToDelete } = props;
  const { mutate: deleteUser, isPending } = useDeleteUserMutation();

  const { t } = useTranslation();

  // The dialog stays open until the request settles: closing it straight away
  // left the admin guessing whether the deletion ran, worked or failed.
  const deleteUserAndClose = () => {
    deleteUser(userToDelete.id, {
      onSuccess: () => {
        notification.deleteUser(userToDelete.username);
        onRequestClose();
      },
      onError: error => {
        // A 401 is handled (and reported) by the fetch client.
        if (error instanceof ApiError && error.status === 401) {
          return;
        }
        notification.requestFailed(
          t("toasts.deleteusererrortitle"),
          (error instanceof ApiError && error.serverMessage) || t("toasts.deleteusererror")
        );
      },
    });
  };

  return (
    <Modal
      styles={modalTitleStyles}
      opened={isOpen}
      centered
      size="md"
      onClose={onRequestClose}
      closeOnClickOutside={!isPending}
      closeOnEscape={!isPending}
      withCloseButton={!isPending}
      title={t("adminarea.titledeleteuser")}
    >
      <Stack>
        <Text size="sm">{t("adminarea.deleteuserconfirmexplanation", { username: userToDelete.username })}</Text>
        <Text size="sm" c="red">
          {t("adminarea.cannotbeundone")}
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onRequestClose} disabled={isPending}>
            {t("cancel")}
          </Button>
          <Button color="red" leftSection={<Trash size={16} />} loading={isPending} onClick={deleteUserAndClose}>
            {t("delete")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
