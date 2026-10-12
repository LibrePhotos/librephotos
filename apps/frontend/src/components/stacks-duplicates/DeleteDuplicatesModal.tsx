import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

export function DeleteDuplicatesModal({
  opened,
  count,
  onClose,
  onConfirm,
}: {
  opened: boolean;
  count: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  // Removing a group cannot be undone, and for a resolved one it also drops the Revert history
  return (
    <Modal opened={opened} onClose={onClose} title={t("duplicates.deleteconfirmtitle", { count })} centered>
      <Stack>
        <Text size="sm">{t("duplicates.deleteconfirmdescription")}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button color="red" onClick={onConfirm}>
            {t("delete")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
