import { ActionIcon, Group, Menu, Tooltip } from "@mantine/core";
import {
  IconAlbum as Album,
  IconDotsVertical as DotsVertical,
  IconDownload as Download,
  IconEye as Eye,
  IconEyeOff as EyeOff,
  IconFileMinus as FileMinus,
  IconGlobe as Globe,
  IconKey as Key,
  IconPhoto as Photo,
  IconPlus as Plus,
  IconShare as Share,
  IconStar as Star,
  IconStarOff as StarOff,
  IconTrash as Trash,
} from "@tabler/icons-react";
import { useLocation } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useRemovePhotoFromUserAlbumMutation } from "../../api_client/albums/hooks";
import { UserAlbum } from "../../api_client/albums/types";
import { serverAddress } from "../../api_client/apiClient";
import { useDownloadPhotosMutation } from "../../api_client/jobs";
import {
  useMarkPhotosDeletedMutation,
  useSetFavoritePhotosMutation,
  useSetPhotosHiddenMutation,
  useSetPhotosPublicMutation,
} from "../../api_client/photos/hooks";
import type { BulkPhotoQuery, SelectionState } from "../../api_client/photos/types";
import { copyToClipboard } from "../../util/util";

type Props = {
  selectedItems: UserAlbum[];
  selectAllMode?: boolean;
  selectAllQuery?: BulkPhotoQuery;
  updateSelectionState: (state: Partial<SelectionState>) => void;
  onSharePhotos: () => void;
  setAlbumCover: (actionType: string, photoId?: string) => void;
  onShareAlbum: () => void;
  onAddToAlbum: () => void;
  title: string;
  albumID?: number | string;
  ownerUsername?: string;
};

export function SelectionActions(props: Readonly<Props>) {
  const { t } = useTranslation();
  const location = useLocation();
  const removePhotosFromAlbum = useRemovePhotoFromUserAlbumMutation();
  const setPhotosHidden = useSetPhotosHiddenMutation();
  const setPhotosPublic = useSetPhotosPublicMutation();
  const setFavoritePhotos = useSetFavoritePhotosMutation();
  const setPhotosDeleted = useMarkPhotosDeletedMutation();
  const downloadPhotoArchive = useDownloadPhotosMutation();

  const {
    selectedItems,
    selectAllMode = false,
    selectAllQuery,
    updateSelectionState,
    onSharePhotos,
    onShareAlbum,
    title,
    setAlbumCover,
    albumID,
    onAddToAlbum,
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
  const getImageHashes = () => {
    return selectedItems.filter(i => !i.isTemp).map(i => i.id);
  };

  // Helper to get excluded hashes for selectAll mode
  const getExcludedHashes = () => {
    return selectedItems.map(i => i.id);
  };

  // Check if any action is possible
  const hasSelection = selectAllMode || selectedItems.length > 0;

  return (
    <Group>
      <Menu width={200}>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" disabled={!hasSelection}>
            <Plus />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>
            {t("selectionactions.album")} ({selectAllMode ? t("selectionbar.all") : selectedItems.length} {t("selectionactions.selected")} )
          </Menu.Label>

          <Menu.Divider />

          <Menu.Item leftSection={<Album />} onClick={() => hasSelection && onAddToAlbum()}>
            {" Album"}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <Menu width={200}>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray">
            <DotsVertical />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>
            {t("selectionactions.photoactions")} ({selectAllMode ? t("selectionbar.all") : selectedItems.length} {t("selectionactions.selected")} )
          </Menu.Label>

          <Menu.Divider />

          <Menu.Item
            leftSection={<Star />}
            disabled={!hasSelection}
            onClick={() => {
              if (selectAllMode) {
                setFavoritePhotos.mutate({
                  select_all: true,
                  query: selectAllQuery ?? {},
                  excluded_hashes: getExcludedHashes(),
                  favorite: true,
                });
              } else {
                setFavoritePhotos.mutate({
                  image_hashes: getImageHashes(),
                  favorite: true,
                });
              }
              resetSelection();
            }}
          >
            {`${t("selectionactions.favorite")}`}
          </Menu.Item>

          <Menu.Item
            leftSection={<StarOff />}
            disabled={!hasSelection}
            onClick={() => {
              if (selectAllMode) {
                setFavoritePhotos.mutate({
                  select_all: true,
                  query: selectAllQuery ?? {},
                  excluded_hashes: getExcludedHashes(),
                  favorite: false,
                });
              } else {
                setFavoritePhotos.mutate({
                  image_hashes: getImageHashes(),
                  favorite: false,
                });
              }
              resetSelection();
            }}
          >
            {`  ${t("selectionactions.unfavorite")}`}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            leftSection={<EyeOff />}
            disabled={!hasSelection}
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
            {`  ${t("selectionactions.hide")}`}
          </Menu.Item>

          <Menu.Item
            leftSection={<Eye />}
            disabled={!hasSelection}
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
            {`  ${t("selectionactions.unhide")}`}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            leftSection={<Globe />}
            disabled={!hasSelection}
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
                const linksToCopy = getImageHashes()
                  .map(ih => `${serverAddress}/media/photos/${ih}.jpg`)
                  .join("\n");
                copyToClipboard(linksToCopy);
              }
              resetSelection();
            }}
          >
            {`  ${t("selectionactions.makepublic")}`}
          </Menu.Item>

          <Menu.Item
            leftSection={<Key />}
            disabled={!hasSelection}
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
            {`  ${t("selectionactions.makeprivate")}`}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            leftSection={<Download />}
            disabled={!hasSelection || selectAllMode}
            onClick={() => {
              // Download doesn't support selectAll mode yet
              if (!selectAllMode) {
                downloadPhotoArchive.mutate({ image_hashes: getImageHashes() });
              }
              resetSelection();
            }}
          >
            {`  ${t("selectionactions.download")}`}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            leftSection={<Trash />}
            disabled={!hasSelection}
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
            {`  ${t("selectionactions.deleted")}`}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            leftSection={<Share />}
            disabled={!hasSelection}
            onClick={() => {
              if (hasSelection) {
                onSharePhotos();
              }
            }}
          >
            {`${t("selectionactions.sharing")}`}
          </Menu.Item>

          {/* Album Actions - only show on album pages */}
          {(location.pathname.startsWith("/album/persons/") || location.pathname.startsWith("/album/user/")) && (
            <>
              <Menu.Divider />

              <Menu.Label>{t("selectionactions.albumactions")}</Menu.Label>

              <Tooltip
                label={t("selectionactions.albumcovermultiselect")}
                disabled={selectedItems.length <= 1 && !selectAllMode}
                position="left"
              >
                <Menu.Item
                  disabled={selectedItems.length > 1 || selectAllMode}
                  leftSection={<Photo />}
                  onClick={() => {
                    if (location.pathname.startsWith("/album/persons/")) {
                      setAlbumCover("person");
                    }
                    if (location.pathname.startsWith("/album/user/")) {
                      setAlbumCover("useralbum");
                    }
                    // Only clear selection if exactly 1 item was selected (used directly)
                    if (selectedItems.length === 1) {
                      resetSelection();
                    }
                  }}
                >
                  {`${t("selectionactions.albumcover")}`}
                </Menu.Item>
              </Tooltip>

              {location.pathname.startsWith("/album/user/") && (
                <>
                  <Menu.Item
                    leftSection={<Share />}
                    onClick={onShareAlbum}
                  >
                    {`  ${t("selectionactions.sharing")}`}
                  </Menu.Item>

                  <Menu.Item
                    leftSection={<FileMinus />}
                    disabled={!hasSelection || selectAllMode}
                    onClick={() => {
                      // Remove from album doesn't support selectAll mode
                      if (!selectAllMode) {
                        removePhotosFromAlbum.mutate({
                          id: `${albumID ?? ""}`,
                          title,
                          photos: getImageHashes(),
                        });
                      }
                      resetSelection();
                    }}
                  >
                    {`  ${t("selectionactions.removephotos")}`}
                  </Menu.Item>
                </>
              )}
            </>
          )}
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
