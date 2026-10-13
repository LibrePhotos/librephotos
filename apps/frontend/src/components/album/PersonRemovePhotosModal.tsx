import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useRemovePhotosFromPersonMutation } from "../../api_client/albums/hooks";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  personId: string;
  personName: string;
  /** `Photo.id` of each selected photo. */
  photoIds: string[];
  /** After the request is sent: the selection ends. */
  onRemoved: () => void;
}>;

/** Asks before taking a person off the selected photos of their page. */
export function PersonRemovePhotosModal({ opened, onClose, personId, personName, photoIds, onRemoved }: Props) {
  const { t } = useTranslation();
  const removePhotos = useRemovePhotosFromPersonMutation();

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("personalbum.removephotostitle", { count: photoIds.length, name: personName })}
    >
      <Stack>
        <Text size="sm">{t("personalbum.removephotosdescription", { count: photoIds.length, name: personName })}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            color="red"
            onClick={() => {
              removePhotos.mutate({ personId, personName, photoIds });
              onClose();
              onRemoved();
            }}
          >
            {/* The title names the person: a long name would not fit the button */}
            {t("selectionactions.removefromperson")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
