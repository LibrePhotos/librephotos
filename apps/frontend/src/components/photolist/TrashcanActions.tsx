import { ActionIcon, Button, Group, Modal } from "@mantine/core";
import { IconArrowBackUp as ArrowBackUp, IconTrash as Trash } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { finalPhotosDeleted } from "../../actions/photosActions";
import { photoDetailsApi } from "../../api_client/photos/photoDetail";
import { notification } from "../../service/notifications";
import { useAppDispatch, useAppSelector } from "../../store/store";

type Props = {
  selectedItems: any[];
  updateSelectionState: (input: any) => void;
};

export function TrashcanActions(props: Readonly<Props>) {
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const dispatch = useAppDispatch();
  const { selectedItems, updateSelectionState } = props;
  const { t } = useTranslation();
  const route = useAppSelector(store => store.router);
  return (
    <Group>
      {
        // @ts-ignore
        route.location.pathname.startsWith("/deleted") && (
          <ActionIcon
            disabled={selectedItems.length === 0}
            onClick={() => {
              const imageHashes = selectedItems.map(i => i.id);
              const deleted = false;
              dispatch(
                photoDetailsApi.endpoints.setPhotosDeleted.initiate({
                  image_hashes: imageHashes,
                  deleted,
                })
              );
              notification.togglePhotoDelete(deleted, imageHashes.length);

              updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
            }}
          >
            <ArrowBackUp />
          </ActionIcon>
        )
      }
      {
        // @ts-ignore
        route.location.pathname.startsWith("/deleted") && (
          <ActionIcon
            disabled={selectedItems.length === 0}
            onClick={() => {
              setOpenDeleteDialog(true);
            }}
          >
            <Trash color="red" />
          </ActionIcon>
        )
      }
      <Modal opened={openDeleteDialog} onClose={() => setOpenDeleteDialog(false)} title="Delete images">
        <Group position="center">
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
              dispatch(finalPhotosDeleted(selectedItems.map(i => i.id)));

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
