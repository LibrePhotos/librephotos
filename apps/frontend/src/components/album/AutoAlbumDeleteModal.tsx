import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The event being deleted, shown in bold above the explanation. */
  title: string;
  onConfirm: () => void;
}>;

export function AutoAlbumDeleteModal({ opened, onClose, title, onConfirm }: Props) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} title={t("autoalbum.delete")} onClose={onClose}>
      <Stack>
        <Text fw={500}>{title}</Text>
        <Text size="sm">{t("autoalbum.deleteexplanation")}</Text>
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
