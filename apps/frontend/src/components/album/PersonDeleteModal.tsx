import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
}>;

export function PersonDeleteModal({ opened, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} title={t("personalbum.deleteperson")} onClose={onClose} returnFocus={false}>
      <Stack>
        <Text size="sm">{t("personalbum.deletepersondescription")}</Text>
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
            {t("delete")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
