import { ActionIcon, Button, Group, Modal } from "@mantine/core";
import React, { useState } from "react";
import { ArrowBackUp, Trash } from "tabler-icons-react";

import { finalPhotosDeleted, setPhotosDeleted } from "../../actions/photosActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

type Props = {
  selectedItems: any[];
  updateSelectionState: (input: any) => void;
};

export const TrashcanActions = (props: Props) => {
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const dispatch = useAppDispatch();
  const { selectedItems, updateSelectionState } = props;

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
            Cancel
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
            Confirm
          </Button>
        </Group>
      </Modal>
    </Group>
  );
};
