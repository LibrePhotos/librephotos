import { ActionIcon, Divider, Group, Menu } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  Album,
  DotsVertical,
  Download,
  Eye,
  EyeOff,
  FileMinus,
  Globe,
  Key,
  Photo,
  Plus,
  Share,
  Star,
  StarOff,
  Trash,
} from "tabler-icons-react";

import { removeFromUserAlbum } from "../../actions/albumsActions";
import {
  downloadPhotos,
  setPhotosDeleted,
  setPhotosFavorite,
  setPhotosHidden,
  setPhotosPublic,
} from "../../actions/photosActions";
import { serverAddress } from "../../api_client/apiClient";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { copyToClipboard } from "../../util/util";

type Props = {
  selectedItems: any[];
  updateSelectionState: (any) => void;
  onSharePhotos: () => void;
  setAlbumCover: (actionType: string) => void;
  onShareAlbum: () => void;
  onAddToAlbum: () => void;
  title: string;
  albumID: any;
};

export const SelectionActions = (props: Props) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const route = useAppSelector(store => store.router);

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
      <Menu
        control={
          <ActionIcon disabled={selectedItems.length === 0}>
            <Plus></Plus>
          </ActionIcon>
        }
      >
        <Menu.Label>
          {t("selectionactions.album")} ({selectedItems.length} {t("selectionactions.selected")} )
        </Menu.Label>
        <Divider />
        <Menu.Item
          onClick={() => {
            if (selectedItems.length > 0) {
              onAddToAlbum();
            }
          }}
        >
          <Album />
          {" Album"}
        </Menu.Item>
      </Menu>
      <Menu
        control={
          <ActionIcon>
            <DotsVertical></DotsVertical>
          </ActionIcon>
        }
      >
        <Menu.Label>
          {t("selectionactions.photoactions")} ({selectedItems.length} {t("selectionactions.selected")} )
        </Menu.Label>
        <Divider />
        <Menu.Item
          icon={<Star></Star>}
          disabled={selectedItems.length === 0}
          onClick={() => {
            dispatch(
              setPhotosFavorite(
                selectedItems.map(i => i.id),
                true
              )
            );
            updateSelectionState({
              selectMode: false,
              selectedItems: [],
            });
          }}
        >
          {`${t("selectionactions.favorite")}`}
        </Menu.Item>
        <Menu.Item
          icon={<StarOff></StarOff>}
          disabled={selectedItems.length === 0}
          onClick={() => {
            dispatch(
              setPhotosFavorite(
                selectedItems.map(i => i.id),
                false
              )
            );

            updateSelectionState({
              selectMode: false,
              selectedItems: [],
            });
          }}
        >
          {`  ${t("selectionactions.unfavorite")}`}
        </Menu.Item>
        <Divider />
        <Menu.Item
          icon={<EyeOff />}
          disabled={selectedItems.length === 0}
          onClick={() => {
            dispatch(
              setPhotosHidden(
                selectedItems.map(i => i.id),
                true
              )
            );

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
            dispatch(
              setPhotosHidden(
                selectedItems.map(i => i.id),
                false
              )
            );

            updateSelectionState({
              selectMode: false,
              selectedItems: [],
            });
          }}
        >
          {`  ${t("selectionactions.unhide")}`}
        </Menu.Item>
        <Divider />
        <Menu.Item
          icon={<Globe />}
          disabled={selectedItems.length === 0}
          onClick={() => {
            dispatch(
              setPhotosPublic(
                selectedItems.map(i => i.id),
                true
              )
            );
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
            dispatch(
              setPhotosPublic(
                selectedItems.map(i => i.id),
                false
              )
            );

            updateSelectionState({
              selectMode: false,
              selectedItems: [],
            });
          }}
        >
          {`  ${t("selectionactions.makeprivate")}`}
        </Menu.Item>
        <Divider />
        <Menu.Item
          icon={<Download />}
          disabled={selectedItems.length === 0}
          onClick={() => {
            dispatch(downloadPhotos(selectedItems.map(i => i.id)));

            updateSelectionState({
              selectMode: false,
              selectedItems: [],
            });
          }}
        >
          {`  ${t("selectionactions.download")}`}
        </Menu.Item>
        <Divider />
        <Menu.Item
          icon={<Trash />}
          disabled={selectedItems.length === 0}
          onClick={() => {
            dispatch(
              setPhotosDeleted(
                selectedItems.map(i => i.id),
                true
              )
            );
            updateSelectionState({
              selectMode: false,
              selectedItems: [],
            });
          }}
        >
          {`  ${t("selectionactions.deleted")}`}
        </Menu.Item>

        <Divider />

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
        <Divider />
        <Menu.Label>{t("selectionactions.albumactions")}</Menu.Label>

        <Menu.Item
          disabled={
            // @ts-ignore
            (!route.location.pathname.startsWith("/person/") &&
              // @ts-ignore
              !route.location.pathname.startsWith("/useralbum/")) ||
            selectedItems.length !== 1
          }
          icon={<Photo />}
          onClick={() => {
            // @ts-ignore
            if (route.location.pathname.startsWith("/person/")) {
              setAlbumCover("person");
            }
            // @ts-ignore
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
          // @ts-ignore
          disabled={!route.location.pathname.startsWith("/useralbum/")}
          onClick={onShareAlbum}
        >
          {`  ${t("selectionactions.sharing")}`}
        </Menu.Item>
        <Menu.Item
          icon={<FileMinus />}
          // @ts-ignore
          disabled={!route.location.pathname.startsWith("/useralbum/" || selectedItems.length == 0)}
          onClick={() => {
            const id = albumID;
            dispatch(
              removeFromUserAlbum(
                id,
                title,
                selectedItems.map(i => i.id)
              )
            );

            updateSelectionState({
              selectMode: false,
              selectedItems: [],
            });
          }}
        >
          {`  ${t("selectionactions.removephotos")}`}
        </Menu.Item>
      </Menu>
    </Group>
  );
};
