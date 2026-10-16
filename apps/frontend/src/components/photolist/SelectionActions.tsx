import type { BulkPhotoQuery, PhotoCategory, PigPhoto } from "@librephotos/api-client";
import { ActionIcon, Group, Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconDotsVertical as DotsVertical,
  IconDownload as Download,
  IconFileText as FileText,
  IconGlobe as Globe,
  IconKey as Key,
  IconPhoto as Photo,
  IconScreenshot as Screenshot,
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
import { SelectionEditItems } from "./SelectionEditItems";
import { selectionLabel } from "./selectionLabel";
import { SelectionRatingItems } from "./SelectionRatingItems";
import { SelectionVisibilityItems } from "./SelectionVisibilityItems";
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
    if (selectAllMode) {
      downloadPhotoArchive.mutate({
        select_all: true,
        query: selectAllQuery ?? {},
        excluded_hashes: getExcludedHashes(),
        userId,
        includeStackedPhotos: options.includeStackedPhotos,
      });
    } else {
      downloadPhotoArchive.mutate({
        image_hashes: getImageHashes(),
        userId,
        includeStackedPhotos: options.includeStackedPhotos,
      });
    }
    resetSelection();
  };

  return (
    <Group>
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
      <AddToMenu reason={noSelection} selection={selection} onAddToAlbum={onAddToAlbum} onAddTags={onAddTags} />

      {/* Wide enough for the one-line notes under Hide and Archive. */}
      <Menu width={260}>
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

          <Menu.Divider />

          <SelectionRatingItems
            disabledReason={noSelection}
            selectAllMode={selectAllMode}
            selection={photoSelection}
            onDone={resetSelection}
          />

          <Menu.Divider />

          <SelectionEditItems
            disabledReason={noSelection}
            onSetLocation={editDialogs.location.open}
            onChangeDateTime={editDialogs.dateTime.open}
            onMoveToFolder={editDialogs.move.open}
          />

          <Menu.Divider />

          <SelectionVisibilityItems disabledReason={noSelection} selection={photoSelection} onDone={resetSelection} />

          <Menu.Divider />

          <DisabledReason reason={noSelection} position="left">
            <Menu.Item leftSection={<Photo size={ICON_SIZE.menu} />} onClick={() => markAs("photo")}>
              {t("selectionactions.markasphoto")}
            </Menu.Item>
          </DisabledReason>

          <DisabledReason reason={noSelection} position="left">
            <Menu.Item leftSection={<Screenshot size={ICON_SIZE.menu} />} onClick={() => markAs("screenshot")}>
              {t("selectionactions.markasscreenshot")}
            </Menu.Item>
          </DisabledReason>

          <DisabledReason reason={noSelection} position="left">
            <Menu.Item leftSection={<FileText size={ICON_SIZE.menu} />} onClick={() => markAs("document")}>
              {t("selectionactions.markasdocument")}
            </Menu.Item>
          </DisabledReason>

          <Menu.Divider />

          <SelectionFileItems
            selectedItems={selectedItems}
            selectAllMode={selectAllMode}
            userId={userId}
            disabledReason={noSelection}
            onDone={resetSelection}
          />

          <DisabledReason reason={noSelection} position="left">
            <Menu.Item
              leftSection={<Globe size={ICON_SIZE.menu} />}
              onClick={() => {
                if (selectAllMode) {
                  setPhotosPublic.mutate({
                    select_all: true,
                    query: selectAllQuery ?? {},
                    excluded_hashes: getExcludedHashes(),
                    val_public: true,
                  });
                  // Note: Can't copy links in selectAll mode as we don't have all hashes
                } else {
                  setPhotosPublic.mutate({
                    image_hashes: getImageHashes(),
                    val_public: true,
                  });
                  // Absolute links (shareMediaUrl: the origin plus the subpath), and
                  // no ".jpg": the same link serves videos too.
                  const linksToCopy = getImageHashes()
                    .map(ih => shareMediaUrl.photo(ih))
                    .join("\n");
                  copyToClipboard(linksToCopy);
                }
                resetSelection();
              }}
            >
              {t("selectionactions.makepublic")}
            </Menu.Item>
          </DisabledReason>

          <DisabledReason reason={noSelection} position="left">
            <Menu.Item
              leftSection={<Key size={ICON_SIZE.menu} />}
              onClick={() => {
                setPhotosPublic.mutate({ ...photoSelection(), val_public: false });
                resetSelection();
              }}
            >
              {t("selectionactions.makeprivate")}
            </Menu.Item>
          </DisabledReason>

          <Menu.Divider />

          <DisabledReason reason={noSelection} position="left">
            <Menu.Item leftSection={<Download size={ICON_SIZE.menu} />} onClick={() => openDownloadModal()}>
              {t("selectionactions.download")}
            </Menu.Item>
          </DisabledReason>

          <Menu.Divider />

          <DisabledReason reason={noSelection} position="left">
            <Menu.Item
              leftSection={<Trash size={ICON_SIZE.menu} />}
              onClick={() => {
                setPhotosDeleted.mutate({ ...photoSelection(), deleted: true });
                resetSelection();
              }}
            >
              {t("selectionactions.deleted")}
            </Menu.Item>
          </DisabledReason>

          <Menu.Divider />

          <DisabledReason reason={noSelection} position="left">
            <Menu.Item leftSection={<Share size={ICON_SIZE.menu} />} onClick={onSharePhotos}>
              {t("selectionactions.sharing")}
            </Menu.Item>
          </DisabledReason>

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
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
