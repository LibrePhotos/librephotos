import type { BulkPhotoQuery, PhotoCategory, PigPhoto } from "@librephotos/api-client";
import { ActionIcon, Group, Menu, Text, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAlbum as Album,
  IconDotsVertical as DotsVertical,
  IconDownload as Download,
  IconEye as Eye,
  IconEyeOff as EyeOff,
  IconFileText as FileText,
  IconGlobe as Globe,
  IconKey as Key,
  IconPhoto as Photo,
  IconPlus as Plus,
  IconScreenshot as Screenshot,
  IconShare as Share,
  IconTag as Tag,
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
  useSetPhotosHiddenMutation,
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
import { albumPageKind, AlbumSelectionActions, type AlbumPageKind } from "./AlbumSelectionActions";
import { SelectionRatingItems } from "./SelectionRatingItems";
import { StackSelectionActions } from "./StackSelectionActions";

/** The albums whose cover the selection can set. */
export type AlbumCoverType = AlbumPageKind;

type Props = {
  selectedItems: PigPhoto[];
  selectAllMode?: boolean;
  selectAllQuery?: BulkPhotoQuery;
  totalCount?: number;
  updateSelectionState: (state: Partial<SelectionState>) => void;
  onSharePhotos: () => void;
  setAlbumCover: (actionType: AlbumCoverType, photoId?: string) => void;
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
  const setPhotosHidden = useSetPhotosHiddenMutation();
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

  // Check if any action is possible
  const hasSelection = selectAllMode || selectedItems.length > 0;
  // Why the photo actions are off (#2608): they say so, and stay in the menu's arrow-key order.
  const noSelection = !hasSelection && t("selectionactions.selectphotosfirst");

  // Fix the media category of the selection; pinned as set by the user, so
  // rescans and Classify Media keep it.
  const markAs = (category: PhotoCategory) => {
    if (selectAllMode) {
      setPhotosCategory.mutate({
        select_all: true,
        query: selectAllQuery ?? {},
        excluded_hashes: getExcludedHashes(),
        category,
      });
    } else {
      setPhotosCategory.mutate({ image_hashes: getImageHashes(), category });
    }
    resetSelection();
  };

  // Download modal state
  const [isDownloadModalOpen, { open: openDownloadModal, close: closeDownloadModal }] = useDisclosure(false);
  const [isRemoveFromPersonOpen, { open: openRemoveFromPerson, close: closeRemoveFromPerson }] = useDisclosure(false);
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
      <Menu width={200}>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={TOOLBAR_ACTION_SIZE}
            disabled={!hasSelection}
            aria-label={t("selectionactions.addto")}
          >
            <Plus size={ICON_SIZE.toolbar} />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>
            {t("selectionactions.album")} ({selectAllMode ? t("selectionbar.all") : selectedItems.length}{" "}
            {t("selectionactions.selected")})
          </Menu.Label>

          <Menu.Divider />

          <Menu.Item leftSection={<Album size={ICON_SIZE.menu} />} onClick={() => hasSelection && onAddToAlbum()}>
            {t("selectionactions.album")}
          </Menu.Item>

          {/* No `disabled`: this menu only opens with a selection (its button is disabled without one). */}
          <Tooltip label={t("selectionactions.tagdescription")} position="left">
            <Menu.Item
              leftSection={<Tag size={ICON_SIZE.menu} />}
              rightSection={
                <Text size="xs" c="dimmed">
                  t
                </Text>
              }
              onClick={() => hasSelection && onAddTags()}
            >
              {t("selectionactions.tag")}
            </Menu.Item>
          </Tooltip>
        </Menu.Dropdown>
      </Menu>

      <Menu width={200}>
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
            {t("selectionactions.photoactions")} ({selectAllMode ? t("selectionbar.all") : selectedItems.length}{" "}
            {t("selectionactions.selected")})
          </Menu.Label>

          <Menu.Divider />

          <SelectionRatingItems
            disabledReason={noSelection}
            selectAllMode={selectAllMode}
            selection={photoSelection}
            onDone={resetSelection}
          />

          <Menu.Divider />

          <DisabledReason reason={noSelection} position="left">
            <Menu.Item
              leftSection={<EyeOff size={ICON_SIZE.menu} />}
              onClick={() => {
                if (selectAllMode) {
                  setPhotosHidden.mutate({
                    select_all: true,
                    query: selectAllQuery ?? {},
                    excluded_hashes: getExcludedHashes(),
                    hidden: true,
                  });
                } else {
                  setPhotosHidden.mutate({
                    image_hashes: getImageHashes(),
                    hidden: true,
                  });
                }
                resetSelection();
              }}
            >
              {t("selectionactions.hide")}
            </Menu.Item>
          </DisabledReason>

          <DisabledReason reason={noSelection} position="left">
            <Menu.Item
              leftSection={<Eye size={ICON_SIZE.menu} />}
              onClick={() => {
                if (selectAllMode) {
                  setPhotosHidden.mutate({
                    select_all: true,
                    query: selectAllQuery ?? {},
                    excluded_hashes: getExcludedHashes(),
                    hidden: false,
                  });
                } else {
                  setPhotosHidden.mutate({
                    image_hashes: getImageHashes(),
                    hidden: false,
                  });
                }
                resetSelection();
              }}
            >
              {t("selectionactions.unhide")}
            </Menu.Item>
          </DisabledReason>

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
                if (selectAllMode) {
                  setPhotosPublic.mutate({
                    select_all: true,
                    query: selectAllQuery ?? {},
                    excluded_hashes: getExcludedHashes(),
                    val_public: false,
                  });
                } else {
                  setPhotosPublic.mutate({
                    image_hashes: getImageHashes(),
                    val_public: false,
                  });
                }
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
                if (selectAllMode) {
                  setPhotosDeleted.mutate({
                    select_all: true,
                    query: selectAllQuery ?? {},
                    excluded_hashes: getExcludedHashes(),
                    deleted: true,
                  });
                } else {
                  setPhotosDeleted.mutate({
                    image_hashes: getImageHashes(),
                    deleted: true,
                  });
                }
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
                // Only clear selection if exactly 1 item was selected (used directly)
                if (selectedItems.length === 1) resetSelection();
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
