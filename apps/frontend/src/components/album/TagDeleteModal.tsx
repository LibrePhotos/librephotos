import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
}>;

export function TagDeleteModal({ opened, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={onClose} title={t("delete")}>
      <Stack>
        <Text>{t("tagalbum.deleteexplanation")}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
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
