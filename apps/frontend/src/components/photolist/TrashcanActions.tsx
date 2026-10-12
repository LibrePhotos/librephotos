import { ActionIcon, Button, Group, Modal, Space, Stack, Text, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconArrowBackUp as ArrowBackUp, IconTrash as Trash } from "@tabler/icons-react";
import { useLocation } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useMarkPhotosDeletedMutation, usePurgeDeletedPhotosMutation } from "../../api_client/photos/hooks";
import type { BulkPhotoQuery, PigPhoto, SelectionState } from "../../api_client/photos/types";

type Props = {
  selectedItems: PigPhoto[];
  selectAllMode?: boolean;
  selectAllQuery?: BulkPhotoQuery;
  totalCount?: number;
  updateSelectionState: (input: Partial<SelectionState>) => void;
};

export function TrashcanActions(props: Readonly<Props>) {
  const [deleteDialogOpen, { open: openDeleteDialog, close: closeDeleteDialog }] = useDisclosure(false);
  const { selectedItems, selectAllMode = false, selectAllQuery, totalCount, updateSelectionState } = props;
  const { t } = useTranslation();
  const location = useLocation();
  const markPhotosDeleted = useMarkPhotosDeletedMutation();
  const purgeDeletedPhotos = usePurgeDeletedPhotosMutation();

  // Helper to get excluded hashes for selectAll mode
  const getExcludedHashes = () => selectedItems.map(i => i.image_hash);

  // Calculate the actual selected count
  const getSelectedCount = () => {
    if (selectAllMode) {
      const excludedCount = selectedItems.length;
      return (totalCount ?? 0) - excludedCount;
    }
    return selectedItems.length;
  };

  const handlePermanentDelete = () => {
    if (selectAllMode) {
      purgeDeletedPhotos.mutate(
        {
          select_all: true,
          query: selectAllQuery ?? {},
          excluded_hashes: getExcludedHashes(),
        },
        {
          onSuccess: () => {
            updateSelectionState({
              selectMode: false,
              selectAllMode: false,
              selectedItems: [],
              selectAllQuery: undefined,
            });
            closeDeleteDialog();
          },
        }
      );
    } else {
      purgeDeletedPhotos.mutate(
        { image_hashes: selectedItems.map(i => i.image_hash) },
        {
          onSuccess: () => {
            updateSelectionState({
              selectMode: false,
              selectAllMode: false,
              selectedItems: [],
              selectAllQuery: undefined,
            });
            closeDeleteDialog();
          },
        }
      );
    }
  };

  // Check if any action is possible
  const hasSelection = selectAllMode || selectedItems.length > 0;
  const selectedCount = getSelectedCount();
  // Shared by each Tooltip and the aria-label of its icon-only button.
  const restoreLabel =
    selectedCount === 1 ? t("trash.restorePhoto") : t("trash.restorePhotos", { count: selectedCount });
  const deleteLabel =
    selectedCount === 1 ? t("trash.deletePermanently") : t("trash.deletePhotosPermanently", { count: selectedCount });

  return (
    <Group>
      {location.pathname.startsWith("/deleted") && (
        <>
          <Tooltip label={restoreLabel} position="bottom" withArrow>
            <ActionIcon
              disabled={!hasSelection}
              variant="light"
              color="blue"
              aria-label={restoreLabel}
              onClick={() => {
                if (selectAllMode) {
                  markPhotosDeleted.mutate(
                    {
                      select_all: true,
                      query: selectAllQuery ?? {},
                      excluded_hashes: getExcludedHashes(),
                      deleted: false,
                    },
                    {
                      onSuccess: () => {
                        updateSelectionState({
                          selectMode: false,
                          selectAllMode: false,
                          selectedItems: [],
                          selectAllQuery: undefined,
                        });
                      },
                    }
                  );
                } else {
                  markPhotosDeleted.mutate(
                    {
                      image_hashes: selectedItems.map(i => i.image_hash),
                      deleted: false,
                    },
                    {
                      onSuccess: () => {
                        updateSelectionState({
                          selectMode: false,
                          selectAllMode: false,
                          selectedItems: [],
                          selectAllQuery: undefined,
                        });
                      },
                    }
                  );
                }
              }}
            >
              <ArrowBackUp />
            </ActionIcon>
          </Tooltip>

          <Tooltip label={deleteLabel} position="bottom" withArrow>
            <ActionIcon
              disabled={!hasSelection}
              variant="light"
              color="red"
              aria-label={deleteLabel}
              onClick={() => {
                openDeleteDialog();
              }}
            >
              <Trash />
            </ActionIcon>
          </Tooltip>
        </>
      )}

      <Modal
        opened={deleteDialogOpen}
        onClose={() => closeDeleteDialog()}
        centered
        size="md"
        // Plain text, styled by the app's Modal theme like every other dialog's title
        title={t("toasts.finaldeletephototitle")}
      >
        <Stack>
          <Text size="sm">{t("trash.permanentDeleteWarning", { count: selectedCount })}</Text>

          <Text size="sm" c="red" fw={500}>
            {t("adminarea.cannotbeundone")}
          </Text>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
            <Button variant="default" onClick={closeDeleteDialog}>
              {t("cancel")}
            </Button>
            <Space w="md" />
            <Button color="red" onClick={handlePermanentDelete} leftSection={<Trash size={16} />}>
              {t("delete")}
            </Button>
          </div>
        </Stack>
      </Modal>
    </Group>
  );
}
