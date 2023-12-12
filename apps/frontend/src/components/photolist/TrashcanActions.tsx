import { ActionIcon, Button, Group, Modal } from "@mantine/core";
import { IconArrowBackUp as ArrowBackUp, IconTrash as Trash } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { finalPhotosDeleted, setPhotosDeleted } from "../../actions/photosActions";
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
              dispatch(
                setPhotosDeleted(
                  selectedItems.map(i => i.id),
                  false
                )
              );

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
