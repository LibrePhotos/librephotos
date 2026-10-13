import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { IconLogout } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { modalTitleStyles } from "../modals/modalTitleStyles";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Files not uploaded yet: waiting or in flight. */
  unfinished: number;
}>;

/** Logging out unmounts the upload queue, so with one running it asks first. */
export function LogoutWhileUploadingModal({ opened, onClose, onConfirm, unfinished }: Props) {
  const { t } = useTranslation();
  return (
    <Modal styles={modalTitleStyles} opened={opened} centered onClose={onClose} title={t("upload.logout.title")}>
      <Stack>
        <Text size="sm">{t("upload.logout.text", { count: unfinished })}</Text>
        <Group justify="flex-end" mt="md">
          {/* The safe choice gets the focus. */}
          <Button variant="default" onClick={onClose} data-autofocus>
            {t("upload.logout.keep")}
          </Button>
          <Button color="red" leftSection={<IconLogout size={16} />} onClick={onConfirm}>
            {t("upload.logout.confirm")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
