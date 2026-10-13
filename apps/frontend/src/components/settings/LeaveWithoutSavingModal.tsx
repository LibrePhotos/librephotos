import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

type LeaveWithoutSavingModalProps = Readonly<{
  opened: boolean;
  /** Stay on the page; the edits stay too. Also Escape, the close button and a click outside. */
  onClose: () => void;
  onLeave: () => void;
}>;

/** Asks before a link takes the user away from edits that are not saved yet (#2224). */
export function LeaveWithoutSavingModal({ opened, onClose, onLeave }: LeaveWithoutSavingModalProps) {
  const { t } = useTranslation();

  return (
    <Modal opened={opened} onClose={onClose} centered title={t("settings.leavewithoutsaving.title")}>
      <Stack>
        <Text size="sm">{t("settings.leavewithoutsaving.description")}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} data-autofocus>
            {t("settings.leavewithoutsaving.stay")}
          </Button>
          <Button color="red" onClick={onLeave}>
            {t("settings.leavewithoutsaving.leave")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
