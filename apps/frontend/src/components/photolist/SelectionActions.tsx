import type { BulkPhotoQuery, PhotoCategory, PigPhoto } from "@librephotos/api-client";
import { ActionIcon, Group, Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconDotsVertical as DotsVertical,
  IconDownload as Download,
  IconShare as Share,
  IconTrash as Trash,
} from "@tabler/icons-react";
import { useLocation } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useRemovePhotoFromUserAlbumMutation } from "../../api_client/albums/hooks";
import { useDownloadPhotosMutation } from "../../api_client/jobs";
import { shareMediaUrl } from "../../api_client/media/mediaUrl";
import {
  useMarkPhotosDeletedMutation,
  useSetPhotosCategoryMutation,
  useSetPhotosPublicMutation,
} from "../../api_client/photos/hooks";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import type { SelectionState } from "../../api_client/photos/types";
import { useAuth } from "../../hooks/useAuth";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE } from "../../uiConstants";
import { copyToClipboard } from "../../util/util";
import { PersonRemovePhotosModal } from "../album/PersonRemovePhotosModal";
import { DisabledReason } from "../common/DisabledReason";
import { ModalDownloadOptions } from "../modals/ModalDownloadOptions";
import { AddToMenu } from "./AddToMenu";
import { albumPageKind, AlbumSelectionActions, type AlbumPageKind } from "./AlbumSelectionActions";
import { SelectionFileItems } from "./FileActionItems";
import { SelectionEditDialogs } from "./SelectionEditDialogs";
import { SelectionEditItems, SelectionMarkAsItems } from "./SelectionEditItems";
import { selectionLabel } from "./selectionLabel";
import { SelectionQuickActions } from "./SelectionQuickActions";
import { SelectionRatingItems } from "./SelectionRatingItems";
import { pairFor, SelectionPublicItems, SelectionVisibilityItems, type Pair } from "./SelectionVisibilityItems";
import { StackSelectionActions } from "./StackSelectionActions";
import { useSelectionEditDialogs } from "./useSelectionEditDialogs";

/** The albums whose cover the selection can set. */
export type AlbumCoverType = AlbumPageKind;

type Props = {
  selectedItems: PigPhoto[];
  selectAllMode?: boolean;
  selectAllQuery?: BulkPhotoQuery;
  totalCount?: number;
  updateSelectionState: (state: Partial<SelectionState>) => void;
  onSharePhotos: () => void;
  setAlbumCover: (actionType: AlbumCoverType) => void;
  onShareAlbum: () => void;
  onAddToAlbum: () => void;
  onAddTags: () => void;
  title: string;
  albumID?: number | string;
  ownerUsername?: string;
  albumLocked?: boolean;
};

export function SelectionActions(props: Readonly<Props>) {
  const { t } = useTranslation();
  const location = useLocation();
  const { userId } = useAuth();
  const removePhotosFromAlbum = useRemovePhotoFromUserAlbumMutation();
  const setPhotosPublic = useSetPhotosPublicMutation();
  const setPhotosDeleted = useMarkPhotosDeletedMutation();
  const setPhotosCategory = useSetPhotosCategoryMutation();
  const downloadPhotoArchive = useDownloadPhotosMutation();

  const {
    selectedItems,
    selectAllMode = false,
    selectAllQuery,
    totalCount,
    updateSelectionState,
    onSharePhotos,
    onShareAlbum,
    title,
    setAlbumCover,
    albumID,
    onAddToAlbum,
    onAddTags,
    albumLocked = false,
  } = props;

  // Helper to reset selection state after action
  const resetSelection = () => {
    updateSelectionState({
      selectMode: false,
      selectAllMode: false,
      selectedItems: [],
      selectAllQuery: undefined,
    });
  };

  // Helper to get valid image hashes (filter out temp items for non-selectAll mode)
  const getImageHashes = () => selectedItems.filter(i => !i.isTemp).map(i => i.image_hash);

  // Helper to get excluded hashes for selectAll mode
  // Placeholder tiles that never loaded have no hash.
  const getExcludedHashes = () => selectedItems.map(i => i.image_hash).filter(Boolean);

  // The selection as a bulk photo mutation takes it
  const photoSelection = (): PhotoSelection =>
    selectAllMode
      ? { select_all: true, query: selectAllQuery ?? {}, excluded_hashes: getExcludedHashes() }
      : { image_hashes: getImageHashes() };

  // The menus' headings say what they act on, in the selection bar's words
  const selection = selectionLabel(t, {
    selectAllMode,
    total: totalCount ?? 0,
    // In select-all mode the list holds the exclusions
    excluded: selectedItems.length,
    selected: selectedItems.length,
  });

  // Check if any action is possible
  const hasSelection = selectAllMode || selectedItems.length > 0;
  // Why the photo actions are off (#2608): they say so, and stay in the menu's arrow-key order.
  const noSelection = !hasSelection && t("selectionactions.selectphotosfirst");

  // Fix the media category of the selection; pinned as set by the user, so
  // rescans and Classify Media keep it.
  const markAs = (category: PhotoCategory) => {
    setPhotosCategory.mutate({ ...photoSelection(), category });
    resetSelection();
  };

  // Making photos public copies their absolute links (shareMediaUrl: the origin plus the subpath, no
  // ".jpg": the same link serves videos too). After Select all there are no hashes to copy.
  const setPublic = (isPublic: boolean) => {
    setPhotosPublic.mutate({ ...photoSelection(), val_public: isPublic });
    if (isPublic && !selectAllMode) {
      copyToClipboard(
        getImageHashes()
          .map(hash => shareMediaUrl.photo(hash))
          .join("\n")
      );
    }
    resetSelection();
  };

  // Archive or Unarchive: one of them when every selected tile says whether it is archived. After
  // Select all only the Archive page's are known to be.
  const onArchivePage = location.pathname.startsWith("/archived");
  let archivePair: Pair = pairFor(selectedItems.filter(item => !item.isTemp).map(item => item.archived));
  if (selectAllMode) archivePair = onArchivePage ? "off" : "both";

  // Download modal state
  const [isDownloadModalOpen, { open: openDownloadModal, close: closeDownloadModal }] = useDisclosure(false);
  const [isRemoveFromPersonOpen, { open: openRemoveFromPerson, close: closeRemoveFromPerson }] = useDisclosure(false);
  const editDialogs = useSelectionEditDialogs();
  const albumPage = albumPageKind(location.pathname);

  // In select-all mode the modal can only show an upper bound, because the
  // server-side query is the source of truth and the excluded set may contain
  // hashes that aren't currently in `selectedItems` (e.g. items scrolled out of
  // virtualised view). Subtracting still gives a reasonable estimate for the UI.
  const downloadPhotoCount = selectAllMode
    ? Math.max(0, (totalCount ?? 0) - getExcludedHashes().length)
    : getImageHashes().length;

  const handleDownloadConfirm = (options: { includeStackedPhotos: boolean }) => {
    downloadPhotoArchive.mutate({ ...photoSelection(), userId, includeStackedPhotos: options.includeStackedPhotos });
    resetSelection();
  };

  return (
    <Group gap={4} wrap="nowrap">
      <ModalDownloadOptions
        isOpen={isDownloadModalOpen}
        photoCount={downloadPhotoCount}
        onRequestClose={() => closeDownloadModal()}
        onConfirm={handleDownloadConfirm}
      />
      <SelectionEditDialogs
        dialogs={editDialogs}
        selection={photoSelection}
        onDone={resetSelection}
        pathname={location.pathname}
      />
      {albumPage === "person" && (
        <PersonRemovePhotosModal
          opened={isRemoveFromPersonOpen}
          onClose={closeRemoveFromPerson}
          personId={`${albumID ?? ""}`}
          personName={title}
          photoIds={selectedItems.filter(i => !i.isTemp).map(i => i.id)}
          onRemoved={resetSelection}
        />
      )}
      <SelectionQuickActions
        disabledReason={noSelection}
        selection={photoSelection}
        onShare={onSharePhotos}
        onDownload={openDownloadModal}
        onDone={resetSelection}
      />
      <AddToMenu reason={noSelection} selection={selection} onAddToAlbum={onAddToAlbum} onAddTags={onAddTags} />

      {/* Wide enough for the one-line notes under Hide and Archive; its right edge on the bar's. */}
      <Menu width={260} position="bottom-end" offset={{ mainAxis: 14, alignmentAxis: -24 }}>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={TOOLBAR_ACTION_SIZE}
            aria-label={t("selectionactions.photoactions")}
          >
            <DotsVertical size={ICON_SIZE.toolbar} />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>
            {t("selectionactions.labelwithselection", { label: t("selectionactions.photoactions"), selection })}
          </Menu.Label>

          <SelectionRatingItems
            disabledReason={noSelection}
            selectAllMode={selectAllMode}
            selectedItems={selectedItems}
            selection={photoSelection}
            onDone={resetSelection}
          />
          <SelectionVisibilityItems
            disabledReason={noSelection}
            selection={photoSelection}
            hide={location.pathname.startsWith("/hidden") ? "off" : "on"}
            archive={archivePair}
            onDone={resetSelection}
          />

          <Menu.Divider />

          <SelectionEditItems
            disabledReason={noSelection}
            onSetLocation={editDialogs.location.open}
            onChangeDateTime={editDialogs.dateTime.open}
            onMoveToFolder={editDialogs.move.open}
            onRenameFiles={editDialogs.rename.open}
            onSetRights={editDialogs.rights.open}
          />
          <SelectionMarkAsItems disabledReason={noSelection} onMarkAs={markAs} />

          <Menu.Divider />

          <DisabledReason reason={noSelection} position="left">
            <Menu.Item leftSection={<Download size={ICON_SIZE.menu} />} onClick={() => openDownloadModal()}>
              {t("selectionactions.download")}
            </Menu.Item>
          </DisabledReason>
          <DisabledReason reason={noSelection} position="left">
            <Menu.Item leftSection={<Share size={ICON_SIZE.menu} />} onClick={onSharePhotos}>
              {t("selectionactions.sharing")}
            </Menu.Item>
          </DisabledReason>
          <SelectionPublicItems disabledReason={noSelection} onSetPublic={setPublic} />

          <StackSelectionActions
            selectedItems={selectedItems}
            selectAllMode={selectAllMode}
            imageHashes={getImageHashes()}
            onDone={resetSelection}
          />

          {albumPage && (
            <AlbumSelectionActions
              kind={albumPage}
              selectedCount={selectedItems.length}
              selectAllMode={selectAllMode}
              albumLocked={albumLocked}
              onSetCover={() => {
                setAlbumCover(albumPage);
                resetSelection();
              }}
              onShareAlbum={onShareAlbum}
              onRemoveFromAlbum={() => {
                removePhotosFromAlbum.mutate({ id: `${albumID ?? ""}`, title, photos: getImageHashes() });
                resetSelection();
              }}
              onRemoveFromPerson={openRemoveFromPerson}
            />
          )}

          <Menu.Divider />

          <SelectionFileItems
            selectedItems={selectedItems}
            selectAllMode={selectAllMode}
            userId={userId}
            disabledReason={noSelection}
            onDone={resetSelection}
          />

          {/* Destructive, so last, red and set apart, as in every menu. */}
          <DisabledReason reason={noSelection} position="left">
            <Menu.Item
              color="red"
              leftSection={<Trash size={ICON_SIZE.menu} />}
              onClick={() => {
                setPhotosDeleted.mutate({ ...photoSelection(), deleted: true });
                resetSelection();
              }}
            >
              {t("selectionactions.deleted")}
            </Menu.Item>
          </DisabledReason>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
