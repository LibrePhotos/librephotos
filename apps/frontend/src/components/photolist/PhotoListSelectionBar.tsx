import type { BulkPhotoQuery, PigPhoto } from "@librephotos/api-client";
import { ActionIcon, Box, Group, Tooltip } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useLocation } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import type { SelectionState } from "../../api_client/photos/types";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE } from "../../uiConstants";
import classes from "./PhotoListSelectionBar.module.css";
import { SelectionActions } from "./SelectionActions";
import type { AlbumCoverType } from "./SelectionActions";
import { SelectionBar } from "./SelectionBar";
import { TrashcanActions } from "./TrashcanActions";
import type { PhotoListDialogState } from "./usePhotoListDialogs";

type Props = Readonly<{
  selectionState: SelectionState;
  idx2hash: PigPhoto[];
  updateSelectionState: (state: Partial<SelectionState>) => void;
  photosetQuery?: BulkPhotoQuery;
  totalCount: number;
  albumID?: string;
  ownerUsername?: string;
  albumLocked: boolean;
  title: string;
  setAlbumCover: (actionType: AlbumCoverType) => void;
  dialogs: PhotoListDialogState;
  /** Leaves select mode, clearing the selection: the ✕. */
  onClose: () => void;
  /** The ✕, which takes focus when the Select button opens the bar. */
  closeRef: React.Ref<HTMLButtonElement>;
}>;

// The selection bar under a photo list's toolbar, while selecting (#2240): leave select mode
// (✕), the selection count, the actions on the selected photos and the trashcan actions.
export function PhotoListSelectionBar({
  selectionState,
  idx2hash,
  updateSelectionState,
  photosetQuery,
  totalCount,
  albumID,
  ownerUsername,
  albumLocked,
  title,
  setAlbumCover,
  dialogs,
  onClose,
  closeRef,
}: Props) {
  const location = useLocation();
  const { t } = useTranslation();
  return (
    <Box className={classes.bar} role="toolbar" aria-label={t("selectionbar.toolbar")}>
      <Group justify="space-between" gap="xs">
        <Group gap="xs">
          <Tooltip label={t("selectionbar.done")} position="bottom">
            <ActionIcon
              ref={closeRef}
              variant="subtle"
              color="gray"
              size={TOOLBAR_ACTION_SIZE}
              aria-label={t("selectionbar.done")}
              onClick={onClose}
            >
              <IconX size={ICON_SIZE.toolbar} />
            </ActionIcon>
          </Tooltip>
          <SelectionBar
            selectMode={selectionState.selectMode}
            selectAllMode={selectionState.selectAllMode}
            selectedItems={selectionState.selectedItems}
            idx2hash={idx2hash}
            updateSelectionState={updateSelectionState}
            photosetQuery={photosetQuery}
            totalCount={totalCount}
          />
        </Group>
        <Group justify="flex-end">
          {!location.pathname.startsWith("/deleted") && (
            <SelectionActions
              selectedItems={selectionState.selectedItems}
              selectAllMode={selectionState.selectAllMode}
              selectAllQuery={selectionState.selectAllQuery}
              totalCount={totalCount}
              albumID={albumID}
              ownerUsername={ownerUsername}
              albumLocked={albumLocked}
              title={title}
              setAlbumCover={setAlbumCover}
              onSharePhotos={() => dialogs.sharePhotos.open()}
              onShareAlbum={() => dialogs.albumShare.open()}
              onAddToAlbum={() => dialogs.addToAlbum.open()}
              onAddTags={() => dialogs.tag.open()}
              updateSelectionState={updateSelectionState}
            />
          )}
          <TrashcanActions
            selectedItems={selectionState.selectedItems}
            selectAllMode={selectionState.selectAllMode}
            selectAllQuery={selectionState.selectAllQuery}
            totalCount={totalCount}
            updateSelectionState={updateSelectionState}
          />
        </Group>
      </Group>
    </Box>
  );
}
