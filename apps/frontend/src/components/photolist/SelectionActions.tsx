import { ActionIcon, Group, Menu } from "@mantine/core";
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
import React from "react";
import { useTranslation } from "react-i18next";

import { UserAlbum } from "../../api_client/albums/types";
import { useRemovePhotoFromUserAlbumMutation } from "../../api_client/albums/user";
import { serverAddress } from "../../api_client/apiClient";
import { useMarkPhotosDeletedMutation } from "../../api_client/photos/delete";
import { useLazyDownloadPhotosQuery } from "../../api_client/photos/download";
import { useSetFavoritePhotosMutation } from "../../api_client/photos/favorite";
import { useSetPhotosHiddenMutation, useSetPhotosPublicMutation } from "../../api_client/photos/visibility";
import { useAppSelector } from "../../store/store";
import { copyToClipboard } from "../../util/util";

type Props = {
  selectedItems: UserAlbum[];
  updateSelectionState: (any) => void;
  onSharePhotos: () => void;
  setAlbumCover: (actionType: string) => void;
  onShareAlbum: () => void;
  onAddToAlbum: () => void;
  title: string;
  albumID: number;
};

export function SelectionActions(props: Readonly<Props>) {
  const { t } = useTranslation();
  const route = useAppSelector(store => store.router);
  const [removePhotosFromAlbum] = useRemovePhotoFromUserAlbumMutation();
  const [setPhotosHidden] = useSetPhotosHiddenMutation();
  const [setPhotosPublic] = useSetPhotosPublicMutation();
  const [setFavoritePhotos] = useSetFavoritePhotosMutation();
  const [setPhotosDeleted] = useMarkPhotosDeletedMutation();
  const [downloadPhotoArchive] = useLazyDownloadPhotosQuery();

  const {
    selectedItems,
    updateSelectionState,
    onSharePhotos,
    onShareAlbum,
    title,
    setAlbumCover,
    albumID,
    onAddToAlbum,
  } = props;

  return (
    <Group>
      <Menu width={200}>
        <Menu.Target>
          <ActionIcon disabled={selectedItems.length === 0}>
            <Plus />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>
            {t("selectionactions.album")} ({selectedItems.length} {t("selectionactions.selected")} )
          </Menu.Label>

          <Menu.Divider />

          <Menu.Item icon={<Album />} onClick={() => selectedItems.length > 0 && onAddToAlbum()}>
            {" Album"}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <Menu width={200}>
        <Menu.Target>
          <ActionIcon>
            <DotsVertical />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>
            {t("selectionactions.photoactions")} ({selectedItems.length} {t("selectionactions.selected")} )
          </Menu.Label>

          <Menu.Divider />

          <Menu.Item
            icon={<Star />}
            disabled={selectedItems.length === 0}
            onClick={() => {
              setFavoritePhotos({
                image_hashes: selectedItems.map(i => i.id),
                favorite: true,
              });
              updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
            }}
          >
            {`${t("selectionactions.favorite")}`}
          </Menu.Item>

          <Menu.Item
            icon={<StarOff />}
            disabled={selectedItems.length === 0}
            onClick={() => {
              setFavoritePhotos({
                image_hashes: selectedItems.map(i => i.id),
                favorite: false,
              });

              updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
            }}
          >
            {`  ${t("selectionactions.unfavorite")}`}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            icon={<EyeOff />}
            disabled={selectedItems.length === 0}
            onClick={() => {
              setPhotosHidden({
                image_hashes: selectedItems.map(i => i.id),
                hidden: true,
              });

              updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
            }}
          >
            {`  ${t("selectionactions.hide")}`}
          </Menu.Item>

          <Menu.Item
            icon={<Eye />}
            disabled={selectedItems.length === 0}
            onClick={() => {
              setPhotosHidden({
                image_hashes: selectedItems.map(i => i.id),
                hidden: false,
              });

              updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
            }}
          >
            {`  ${t("selectionactions.unhide")}`}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            icon={<Globe />}
            disabled={selectedItems.length === 0}
            onClick={() => {
              setPhotosPublic({
                image_hashes: selectedItems.map(i => i.id),
                val_public: true,
              });
              const linksToCopy = selectedItems
                .map(i => i.id)
                .map(ih => `${serverAddress}/media/photos/${ih}.jpg`)
                .join("\n");
              copyToClipboard(linksToCopy);

              updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
            }}
          >
            {`  ${t("selectionactions.makepublic")}`}
          </Menu.Item>

          <Menu.Item
            icon={<Key />}
            disabled={selectedItems.length === 0}
            onClick={() => {
              setPhotosPublic({
                image_hashes: selectedItems.map(i => i.id),
                val_public: false,
              });

              updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
            }}
          >
            {`  ${t("selectionactions.makeprivate")}`}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            icon={<Download />}
            disabled={selectedItems.length === 0}
            onClick={() => {
              downloadPhotoArchive({ image_hashes: selectedItems.map(i => i.id) });

              updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
            }}
          >
            {`  ${t("selectionactions.download")}`}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            icon={<Trash />}
            disabled={selectedItems.length === 0}
            onClick={() => {
              setPhotosDeleted({ image_hashes: selectedItems.map(i => i.id), deleted: true });
              updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
            }}
          >
            {`  ${t("selectionactions.deleted")}`}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            icon={<Share />}
            disabled={selectedItems.length === 0}
            onClick={() => {
              if (selectedItems.length > 0) {
                onSharePhotos();
              }
            }}
          >
            {`${t("selectionactions.sharing")}`}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Label>{t("selectionactions.albumactions")}</Menu.Label>

          <Menu.Item
            disabled={
              (!route.location.pathname.startsWith("/person/") && !route.location.pathname.startsWith("/useralbum/")) ||
              selectedItems.length !== 1
            }
            icon={<Photo />}
            onClick={() => {
              if (route.location.pathname.startsWith("/person/")) {
                setAlbumCover("person");
              }
              if (route.location.pathname.startsWith("/useralbum/")) {
                setAlbumCover("useralbum");
              }
              updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
            }}
          >
            {`${t("selectionactions.albumcover")}`}
          </Menu.Item>

          <Menu.Item
            icon={<Share />}
            disabled={!route.location.pathname.startsWith("/useralbum/")}
            onClick={onShareAlbum}
          >
            {`  ${t("selectionactions.sharing")}`}
          </Menu.Item>

          <Menu.Item
            icon={<FileMinus />}
            disabled={!route.location.pathname.startsWith("/useralbum/") || selectedItems.length === 0}
            onClick={() => {
              removePhotosFromAlbum({
                id: albumID.toString(),
                title,
                photos: selectedItems.map(i => i.id),
              });
              updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
            }}
          >
            {`  ${t("selectionactions.removephotos")}`}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
