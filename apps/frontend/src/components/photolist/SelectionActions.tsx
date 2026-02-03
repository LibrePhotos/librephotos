import { ActionIcon, Group, Menu, Tooltip } from "@mantine/core";
import {
  IconAlbum as Album,
  IconDotsVertical as DotsVertical,
  IconDownload as Download,
  IconEye as Eye,
  IconEyeOff as EyeOff,
  IconFileMinus as FileMinus,
  IconGlobe as Globe,
  IconLayersLinked,
  IconLayersSubtract,
  IconStack2,
  IconKey as Key,
  IconPhoto as Photo,
  IconPlus as Plus,
  IconShare as Share,
  IconStar as Star,
  IconStarOff as StarOff,
  IconTrash as Trash,
} from "@tabler/icons-react";
import { useLocation } from "@tanstack/react-router";
import React, { useState } from "react";
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
import {
  useCreateManualStackMutation,
  useMergeStacksMutation,
  useRemoveFromStackMutation,
} from "../../api_client/stacks";
import { useAuth } from "../../hooks/useAuth";
import { copyToClipboard } from "../../util/util";
import { ModalDownloadOptions } from "../modals/ModalDownloadOptions";

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
  const { userId } = useAuth();
  const removePhotosFromAlbum = useRemovePhotoFromUserAlbumMutation();
  const setPhotosHidden = useSetPhotosHiddenMutation();
  const setPhotosPublic = useSetPhotosPublicMutation();
  const setFavoritePhotos = useSetFavoritePhotosMutation();
  const setPhotosDeleted = useMarkPhotosDeletedMutation();
  const downloadPhotoArchive = useDownloadPhotosMutation();
  const createManualStack = useCreateManualStackMutation();
  const mergeStacks = useMergeStacksMutation();
  const removeFromStack = useRemoveFromStackMutation();

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
  const getImageHashes = () =>
    selectedItems
      .filter(i => !i.isTemp)
      .map(i => {
        // Use image_hash if available (PigPhoto type), otherwise fall back to id
        const photo = i as unknown as { image_hash?: string };
        return photo.image_hash || i.id;
      });

  // Helper to get excluded hashes for selectAll mode
  const getExcludedHashes = () => selectedItems.map(i => i.id);

  // Helper to get manual stacks from selected photos
  const getManualStacksFromSelection = (): Array<{ stackId: string; photoHash: string }> => {
    const result: Array<{ stackId: string; photoHash: string }> = [];
    selectedItems.forEach(item => {
      // Check if item has stacks property (from PigPhoto type)
      const photo = item as unknown as {
        stacks?: Array<{ id: string; type: string }>;
        image_hash?: string;
      };
      // Use image_hash if available, otherwise fall back to id
      const photoHash = photo.image_hash || item.id;
      if (photo.stacks && Array.isArray(photo.stacks)) {
        photo.stacks.forEach(stack => {
          if (stack.type === "manual") {
            result.push({ stackId: stack.id, photoHash });
          }
        });
      }
    });
    return result;
  };

  // Helper to check if any selected photos are in manual stacks
  const hasPhotosInManualStacks = (): boolean => getManualStacksFromSelection().length > 0;

  // Check if any action is possible
  const hasSelection = selectAllMode || selectedItems.length > 0;

  // Download modal state
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);

  const handleDownloadConfirm = (options: { includeStackedPhotos: boolean }) => {
    downloadPhotoArchive.mutate({
      image_hashes: getImageHashes(),
      userId,
      includeStackedPhotos: options.includeStackedPhotos,
    });
    resetSelection();
  };

  return (
    <Group>
      <ModalDownloadOptions
        isOpen={isDownloadModalOpen}
        photoCount={getImageHashes().length}
        onRequestClose={() => setIsDownloadModalOpen(false)}
        onConfirm={handleDownloadConfirm}
      />
      <Menu width={200}>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" disabled={!hasSelection}>
            <Plus />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>
            {t("selectionactions.album")} ({selectAllMode ? t("selectionbar.all") : selectedItems.length}{" "}
            {t("selectionactions.selected")} )
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
            {t("selectionactions.photoactions")} ({selectAllMode ? t("selectionbar.all") : selectedItems.length}{" "}
            {t("selectionactions.selected")} )
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
                setIsDownloadModalOpen(true);
              }
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

          {/* Stack Actions */}
          <Menu.Divider />

          <Menu.Label>{t("selectionactions.stackactions", "Stack Actions")}</Menu.Label>

          <Menu.Item
            leftSection={<IconStack2 size={16} />}
            disabled={!hasSelection || selectAllMode || selectedItems.length < 2}
            onClick={() => {
              if (!selectAllMode && selectedItems.length >= 2) {
                createManualStack.mutate(
                  { photo_hashes: getImageHashes() },
                  {
                    onSuccess: () => {
                      resetSelection();
                    },
                  }
                );
              }
            }}
          >
            {t("selectionactions.createstack", "Create Stack")}
          </Menu.Item>

          <Menu.Item
            leftSection={<IconLayersLinked size={16} />}
            disabled={!hasSelection || selectAllMode || !hasPhotosInManualStacks()}
            onClick={() => {
              if (!selectAllMode && hasPhotosInManualStacks()) {
                mergeStacks.mutate(
                  { photo_hashes: getImageHashes() },
                  {
                    onSuccess: () => {
                      resetSelection();
                    },
                  }
                );
              }
            }}
          >
            {t("selectionactions.mergestacks", "Merge Stacks")}
          </Menu.Item>

          <Menu.Item
            leftSection={<IconLayersSubtract size={16} />}
            disabled={!hasSelection || selectAllMode || !hasPhotosInManualStacks()}
            onClick={() => {
              if (!selectAllMode && hasPhotosInManualStacks()) {
                const stackPhotos = getManualStacksFromSelection();
                // Group by stack ID to remove photos from each stack
                const stacksByStackId = new Map<string, string[]>();
                stackPhotos.forEach(({ stackId, photoHash }) => {
                  if (!stacksByStackId.has(stackId)) {
                    stacksByStackId.set(stackId, []);
                  }
                  stacksByStackId.get(stackId)!.push(photoHash);
                });

                // Remove photos from each stack
                const promises = Array.from(stacksByStackId.entries()).map(([stackId, photoHashes]) =>
                  removeFromStack.mutateAsync({
                    stackId,
                    data: { photo_hashes: photoHashes },
                  })
                );

                Promise.all(promises).then(() => {
                  resetSelection();
                });
              }
            }}
          >
            {t("selectionactions.breakapartstacks", "Break Apart Stacks")}
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
                  <Menu.Item leftSection={<Share />} onClick={onShareAlbum}>
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

      <ModalDownloadOptions
        isOpen={isDownloadModalOpen}
        photoCount={getImageHashes().length}
        onRequestClose={() => setIsDownloadModalOpen(false)}
        onConfirm={handleDownloadConfirm}
      />
    </Group>
  );
}
