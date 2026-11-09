import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { DIALOG_SIZE } from "../modals/dialogSize";

/** Asks before deleting a person; the parent puts focus back on its ⋮ button. */
export function DeletePersonModal({
  opened,
  onClose,
  onDelete,
}: Readonly<{ opened: boolean; onClose: () => void; onDelete: () => void }>) {
  const { t } = useTranslation();
  return (
    <Modal
      size={DIALOG_SIZE.sm}
      opened={opened}
      title={t("personalbum.deleteperson")}
      onClose={onClose}
      returnFocus={false}
    >
      <Stack>
        <Text size="sm">{t("personalbum.deletepersondescription")}</Text>
        <Group justify="flex-end">
          <Button variant="light" onClick={onClose} data-autofocus>
            {t("cancel")}
          </Button>
          <Button color="red" onClick={onDelete}>
            {t("delete")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
