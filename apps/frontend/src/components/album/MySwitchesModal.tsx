import { FocusTrap, Modal, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserAlbumQuery } from "../../api_client/albums/hooks";
import { PageLoader } from "../common/PageLoader";
import { DIALOG_SIZE } from "../modals/dialogSize";
import { ConsentTable } from "../sharing/ConsentTable";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  album: Readonly<{ id: number | string; title: string }>;
}>;

/** What the other members see of the photos you added to an album shared with you (#464). */
export function MySwitchesModal({ opened, onClose, album }: Props) {
  const { t } = useTranslation();
  const { data: detail } = useFetchUserAlbumQuery(opened ? String(album.id) : "");
  return (
    <Modal
      size={DIALOG_SIZE.md}
      opened={opened}
      onClose={onClose}
      title={t("collab.mySwitchesTitle", { title: album.title })}
    >
      {/* No focus ring at open: nothing is focused until Tab */}
      <FocusTrap.InitialFocus />
      <Stack>
        {detail ? <ConsentTable album={detail} /> : <PageLoader />}
        <Text size="xs" c="dimmed">
          {t("collab.consentNote")}
        </Text>
      </Stack>
    </Modal>
  );
}
