import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { DIALOG_SIZE } from "../modals/dialogSize";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
}>;

export function TagDeleteModal({ opened, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  return (
    <Modal size={DIALOG_SIZE.sm} opened={opened} onClose={onClose} title={t("delete")}>
      <Stack>
        <Text>{t("tagalbum.deleteexplanation")}</Text>
        <Group justify="flex-end">
          <Button variant="light" onClick={onClose} data-autofocus>
            {t("cancel")}
          </Button>
          <Button
            color="red"
            onClick={() => {
              onConfirm();
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
