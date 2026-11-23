import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { DIALOG_SIZE } from "../../modals/dialogSize";
import { modalTitleStyles } from "../../modals/modalTitleStyles";

type Props = Readonly<{
  opened: boolean;
  /** Keep editing: also Escape, the close button and a click outside. */
  onClose: () => void;
  onDiscard: () => void;
  onSave: () => void;
  saving: boolean;
}>;

/**
 * Asks before the editor closes, or the page is left, with changes that are not saved: Discard,
 * Keep editing (which has the focus, so Enter or Escape never loses anything) or Save.
 */
export function UnsavedEditModal({ opened, onClose, onDiscard, onSave, saving }: Props) {
  const { t } = useTranslation();
  return (
    <Modal
      size={DIALOG_SIZE.sm}
      styles={modalTitleStyles}
      zIndex={1500}
      opened={opened}
      onClose={onClose}
      title={t("editor.unsaved.title")}
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
      withCloseButton={!saving}
    >
      <Stack gap="sm">
        <Text size="sm">{t("editor.unsaved.message")}</Text>
        <Group justify="flex-end" gap="xs" wrap="wrap">
          <Button variant="subtle" color="red" onClick={onDiscard} disabled={saving}>
            {t("editor.unsaved.discard")}
          </Button>
          <Button variant="light" onClick={onClose} disabled={saving} data-autofocus>
            {t("editor.unsaved.keep")}
          </Button>
          <Button onClick={onSave} loading={saving}>
            {t("editor.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
