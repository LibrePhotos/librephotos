import { Button, Checkbox, FocusTrap, Group, Modal, Stack, Text } from "@mantine/core";
import { IconDownload as Download } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { DIALOG_SIZE } from "./dialogSize";
import { modalTitleStyles } from "./modalTitleStyles";

type Props = Readonly<{
  isOpen: boolean;
  photoCount: number;
  onRequestClose: () => void;
  onConfirm: (options: { includeStackedPhotos: boolean }) => void;
}>;

export function ModalDownloadOptions(props: Props) {
  const { isOpen, photoCount, onRequestClose, onConfirm } = props;
  const { t } = useTranslation();
  const [includeStackedPhotos, setIncludeStackedPhotos] = useState(false);

  const handleClose = () => {
    setIncludeStackedPhotos(false);
    onRequestClose();
  };

  const handleConfirm = () => {
    onConfirm({ includeStackedPhotos });
    handleClose();
  };

  return (
    <Modal
      size={DIALOG_SIZE.md}
      styles={modalTitleStyles}
      opened={isOpen}
      onClose={handleClose}
      title={t("download.title")}
    >
      {/* No focus ring at open: nothing is focused until Tab */}
      <FocusTrap.InitialFocus />
      <Stack gap="md">
        <Text size="sm">{t("download.selectedcount", { count: photoCount })}</Text>

        <Checkbox
          label={t("download.includestacked")}
          description={t("download.includestackeddesc")}
          checked={includeStackedPhotos}
          onChange={event => setIncludeStackedPhotos(event.currentTarget.checked)}
        />

        <Group justify="flex-end" mt="md">
          <Button variant="light" onClick={handleClose}>
            {t("cancel")}
          </Button>
          <Button leftSection={<Download size={16} />} onClick={handleConfirm}>
            {t("download.start")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
