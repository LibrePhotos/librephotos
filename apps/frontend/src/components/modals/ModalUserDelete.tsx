import { Button, Modal, Space, Text, Title } from "@mantine/core";
import { IconTrash as Trash } from "@tabler/icons-react";
import React from "react";
import { Trans, useTranslation } from "react-i18next";

import { useDeleteUserMutation } from "../../api_client/api";

type Props = Readonly<{
  isOpen: boolean;
  userToDelete: any;
  onRequestClose: () => void;
}>;

export function ModalUserDelete(props: Props) {
  const { isOpen, onRequestClose, userToDelete } = props;
  const [deleteUser] = useDeleteUserMutation();

  const { t } = useTranslation();

  const clearStateAndClose = () => {
    onRequestClose();
  };

  const deleteUserAndClose = () => {
    deleteUser({ id: userToDelete.id });
    clearStateAndClose();
  };

  return (
    <Modal
      opened={isOpen}
      centered
      size="md"
      onClose={() => {
        clearStateAndClose();
      }}
      title={
        <Title order={5}>
          <span style={{ paddingRight: "5px" }}>
            <Trash size={16} />
          </span>
          <Trans i18nKey="adminarea.titledeleteuser">Delete User</Trans>
        </Title>
      }
    >
      <Text size="sm">
        <Trans i18nKey="adminarea.deleteuserconfirmexplanation" username={userToDelete.username}>
          You are about to delete the following user: {{ username: userToDelete.username }}. This will delete all
          associated data.
        </Trans>
      </Text>
      <br />
      <Text size="sm" color="red">
        <Trans i18nKey="adminarea.cannotbeundone">This action cannot be undone.</Trans>
      </Text>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="default" onClick={() => clearStateAndClose()}>
          {t("cancel")}
        </Button>
        <Space w="md" />
        <Button disabled={!true} onClick={() => deleteUserAndClose()}>
          {t("confirm")}
        </Button>
      </div>
    </Modal>
  );
}
