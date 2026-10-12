import { Badge, Button, Group, HoverCard, Modal, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { useDeleteMissingPhotosMutation } from "../../api_client/photos/hooks";

type MissingPhotosBadgeProps = {
  count: number;
};

/** The count of photos missing on disk, next to the Photos title, and the dialog that removes them. */
export function MissingPhotosBadge({ count }: MissingPhotosBadgeProps) {
  const [isOpen, { open, close }] = useDisclosure(false);
  const { t } = useTranslation();
  const deleteMissingPhotos = useDeleteMissingPhotosMutation();

  const onDeleteMissingPhotosButtonClick = () => {
    deleteMissingPhotos.mutate();
    close();
  };

  return (
    <>
      {count > 0 && (
        <HoverCard width={280} shadow="md">
          <HoverCard.Target>
            <Badge onClick={open} color="red" ml={10}>
              {count} <Trans i18nKey="settings.missingphotos" />
            </Badge>
          </HoverCard.Target>
          <HoverCard.Dropdown>
            <Text size="sm">
              <Trans i18nKey="settings.missingphotosdescription" />
            </Text>
          </HoverCard.Dropdown>
        </HoverCard>
      )}
      <Modal opened={isOpen} title={t("settings.missingphotosbutton")} onClose={close}>
        <Stack gap="xl">
          <Text size="sm">{t("settings.missingphotosconfirm")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {t("cancel")}
            </Button>
            <Button color="red" onClick={onDeleteMissingPhotosButtonClick}>
              {t("confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
