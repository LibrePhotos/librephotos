import { ActionIcon, Button, Group, Modal, Stack, Text, Title, Space, Tooltip } from "@mantine/core";
import { IconArrowBackUp as ArrowBackUp, IconTrash as Trash } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocation } from "@tanstack/react-router";
import { BulkPhotoQuery } from "../../api_client/photos/types";
import { useMarkPhotosDeletedMutation, usePurgeDeletedPhotosMutation } from "../../api_client/photos/hooks";

type Props = {
  selectedItems: any[];
  selectAllMode?: boolean;
  selectAllQuery?: BulkPhotoQuery;
  updateSelectionState: (input: any) => void;
};

export function TrashcanActions(props: Readonly<Props>) {
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const { selectedItems, selectAllMode = false, selectAllQuery, updateSelectionState } = props;
  const { t } = useTranslation();
  const location = useLocation();
  const markPhotosDeleted = useMarkPhotosDeletedMutation();
  const purgeDeletedPhotos = usePurgeDeletedPhotosMutation();

  const closeDialog = () => {
    setOpenDeleteDialog(false);
  };

  // Helper to get excluded hashes for selectAll mode
  const getExcludedHashes = () => {
    return selectedItems.map(i => i.id);
  };

  const handlePermanentDelete = () => {
    if (selectAllMode) {
      purgeDeletedPhotos.mutate({
        select_all: true,
        query: selectAllQuery ?? {},
        excluded_hashes: getExcludedHashes(),
      });
    } else {
      purgeDeletedPhotos.mutate({ image_hashes: selectedItems.map(i => i.id) });
    }
    updateSelectionState({
      selectMode: false,
      selectAllMode: false,
      selectedItems: [],
      selectAllQuery: undefined,
    });
    closeDialog();
  };

  // Check if any action is possible
  const hasSelection = selectAllMode || selectedItems.length > 0;
  const selectedCount = selectedItems.length;

  return (
    <Group>
      {location.pathname.startsWith("/deleted") && (
        <>
          <Tooltip 
            label={selectedCount === 1 ? t("trash.restorePhoto") : t("trash.restorePhotos", { count: selectedCount })} 
            position="bottom" 
            withArrow
          >
            <ActionIcon
              disabled={!hasSelection}
              variant="light"
              color="blue"
              size="lg"
              onClick={() => {
                if (selectAllMode) {
                  markPhotosDeleted.mutate({
                    select_all: true,
                    query: selectAllQuery ?? {},
                    excluded_hashes: getExcludedHashes(),
                    deleted: false,
                  });
                } else {
                  markPhotosDeleted.mutate({
                    image_hashes: selectedItems.map(i => i.id),
                    deleted: false,
                  });
                }
                updateSelectionState({
                  selectMode: false,
                  selectAllMode: false,
                  selectedItems: [],
                  selectAllQuery: undefined,
                });
              }}
            >
              <ArrowBackUp />
            </ActionIcon>
          </Tooltip>
          
          <Tooltip 
            label={selectedCount === 1 ? t("trash.deletePermanently") : t("trash.deletePhotosPermanently", { count: selectedCount })} 
            position="bottom" 
            withArrow
          >
            <ActionIcon
              disabled={!hasSelection}
              variant="light"
              color="red"
              size="lg"
              onClick={() => {
                setOpenDeleteDialog(true);
              }}
            >
              <Trash />
            </ActionIcon>
          </Tooltip>
        </>
      )}
      
      <Modal 
        opened={openDeleteDialog} 
        onClose={closeDialog} 
        centered
        size="md"
        title={
          <Title order={5}>
            <span style={{ paddingRight: "8px" }}>
              <Trash size={20} />
            </span>
            {t("toasts.finaldeletephototitle")}
          </Title>
        }
      >
        <Stack>
          <Text size="sm">
            {t("trash.permanentDeleteWarning", { count: selectedCount })}
          </Text>
          
          <Text size="sm" c="red" fw={500}>
            {t("adminarea.cannotbeundone")}
          </Text>
          
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
            <Button variant="default" onClick={closeDialog}>
              {t("cancel")}
            </Button>
            <Space w="md" />
            <Button 
              color="red" 
              onClick={handlePermanentDelete}
              leftSection={<Trash size={16} />}
            >
              {t("delete")}
            </Button>
          </div>
        </Stack>
      </Modal>
    </Group>
  );
}
