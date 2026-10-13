import { Badge, Button, Group, HoverCard, Modal, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { useDeleteMissingPhotosMutation } from "../../api_client/photos/hooks";

type MissingPhotosBadgeProps = {
  count: number;
};

/**
 * What "Remove missing photos" deletes. With the count, so a library that only looks missing
 * (an unmounted disk) is not wiped by a click on a generic warning (#2195).
 */
export function MissingPhotosConfirmText({ count }: { count: number | undefined }) {
  const { t } = useTranslation();
  return (
    <Text size="sm">
      {count === undefined ? t("settings.missingphotosconfirm") : t("settings.missingphotosconfirmcount", { count })}
    </Text>
  );
}

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
            {/* A real button, so Tab reaches it and Enter or Space open the dialog */}
            <Badge component="button" type="button" onClick={open} color="red" ml={10}>
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
          <MissingPhotosConfirmText count={count} />
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
