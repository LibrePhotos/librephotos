import type { BulkPhotoQuery, PigPhoto } from "@librephotos/api-client";
import { ActionIcon, Box, Group, Tooltip } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useLocation } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, PAGE_GUTTER_PX, TOOLBAR_ACTION_SIZE } from "../../uiConstants";
import { ContributorSelectionActions } from "./ContributorSelectionActions";
import { selectedOf } from "./photoListSelection";
import type { ListSelection, SelectionEvent } from "./photoListSelection";
import classes from "./PhotoListSelectionBar.module.css";
import { SelectionActions } from "./SelectionActions";
import type { AlbumCoverType } from "./SelectionActions";
import { SelectionBar } from "./SelectionBar";
import { TrashcanActions } from "./TrashcanActions";
import type { PhotoListDialogState } from "./usePhotoListDialogs";

type Props = Readonly<{
  selection: ListSelection;
  idx2hash: PigPhoto[];
  dispatch: (event: SelectionEvent) => void;
  photosetQuery?: BulkPhotoQuery;
  totalCount: number;
  albumID?: string;
  ownerUsername?: string;
  albumLocked: boolean;
  /** Only the contributor's action (#464): remove the photos they added. */
  contributor: boolean;
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
  selection,
  idx2hash,
  dispatch,
  photosetQuery,
  totalCount,
  albumID,
  ownerUsername,
  albumLocked,
  contributor,
  title,
  setAlbumCover,
  dialogs,
  onClose,
  closeRef,
}: Props) {
  const location = useLocation();
  const { t } = useTranslation();
  const selected = selectedOf(selection, totalCount);
  return (
    <Box className={classes.bar} mx={PAGE_GUTTER_PX} role="toolbar" aria-label={t("selectionbar.toolbar")}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        {/* One line on every phone: the count gives way (ellipsis) before anything wraps */}
        <Group gap="xs" wrap="nowrap" className={classes.lead}>
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
            selection={selection}
            dispatch={dispatch}
            idx2hash={idx2hash}
            photosetQuery={photosetQuery}
            totalCount={totalCount}
          />
        </Group>
        <Group justify="flex-end" gap="xs" wrap="nowrap" className={classes.actions}>
          {contributor && (
            <ContributorSelectionActions
              selected={selected}
              albumID={albumID ?? ""}
              albumLocked={albumLocked}
              title={title}
              onDone={onClose}
            />
          )}
          {!contributor && !location.pathname.startsWith("/deleted") && (
            <SelectionActions
              selected={selected}
              albumID={albumID}
              ownerUsername={ownerUsername}
              albumLocked={albumLocked}
              title={title}
              setAlbumCover={setAlbumCover}
              onSharePhotos={() => dialogs.sharePhotos.open()}
              onShareAlbum={() => dialogs.albumShare.open()}
              onAddToAlbum={() => dialogs.addToAlbum.open()}
              onAddTags={() => dialogs.tag.open()}
              onDone={onClose}
            />
          )}
          {!contributor && <TrashcanActions selected={selected} onDone={onClose} />}
        </Group>
      </Group>
    </Box>
  );
}
