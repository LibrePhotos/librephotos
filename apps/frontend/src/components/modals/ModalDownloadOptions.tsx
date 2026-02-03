import { Button, Checkbox, Group, Modal, Stack, Text, Title } from "@mantine/core";
import { IconDownload as Download } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

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
      opened={isOpen}
      centered
      size="md"
      onClose={handleClose}
      title={
        <Title order={5}>
          <Group gap="xs">
            <Download size={16} />
            {t("download.title", "Download Photos")}
          </Group>
        </Title>
      }
    >
      <Stack gap="md">
        <Text size="sm">
          {t("download.selectedcount", "You have selected {{count}} photo(s) to download.", { count: photoCount })}
        </Text>

        <Checkbox
          label={t("download.includestacked", "Include all photos from stacks")}
          description={t(
            "download.includestackeddesc",
            "When enabled, all photos from burst sequences, brackets, and manual stacks will be included in the download."
          )}
          checked={includeStackedPhotos}
          onChange={event => setIncludeStackedPhotos(event.currentTarget.checked)}
        />

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={handleClose}>
            {t("cancel")}
          </Button>
          <Button leftSection={<Download size={16} />} onClick={handleConfirm}>
            {t("download.start", "Download")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
