import { ActionIcon, Button, Group, Modal } from "@mantine/core";
import { IconArrowBackUp as ArrowBackUp, IconTrash as Trash } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocation } from "@tanstack/react-router";
import { useMarkPhotosDeletedMutation, usePurgeDeletedPhotosMutation } from "../../api_client/photos/hooks";

type Props = {
  selectedItems: any[];
  updateSelectionState: (input: any) => void;
};

export function TrashcanActions(props: Readonly<Props>) {
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const { selectedItems, updateSelectionState } = props;
  const { t } = useTranslation();
  const location = useLocation();
  const markPhotosDeleted = useMarkPhotosDeletedMutation();
  const purgeDeletedPhotos = usePurgeDeletedPhotosMutation();

  return (
    <Group>
      {location.pathname.startsWith("/deleted") && (
        <>
          <ActionIcon
            disabled={selectedItems.length === 0}
            onClick={() => {
              markPhotosDeleted.mutate({
                image_hashes: selectedItems.map(i => i.id),
                deleted: false,
              });
              updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
            }}
          >
            <ArrowBackUp />
          </ActionIcon>
          <ActionIcon
            disabled={selectedItems.length === 0}
            onClick={() => {
              setOpenDeleteDialog(true);
            }}
          >
            <Trash color="red" />
          </ActionIcon>
        </>
      )}
      <Modal opened={openDeleteDialog} onClose={() => setOpenDeleteDialog(false)} title="Delete images">
        <Group justify="center">
          <Button
            color="blue"
            onClick={() => {
              setOpenDeleteDialog(false);
            }}
          >
            {t("cancel")}
          </Button>
          <Button
            color="red"
            onClick={() => {
              purgeDeletedPhotos.mutate({ image_hashes: selectedItems.map(i => i.id) });
              updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
              setOpenDeleteDialog(false);
            }}
          >
            {t("confirm")}
          </Button>
        </Group>
      </Modal>
    </Group>
  );
}
