import { Badge, Button, Divider, Group, Modal, Stack, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAddPhotoToUserAlbumMutation,
  useCreateUserAlbumMutation,
  useFetchUserAlbumsQuery,
} from "../../../api_client/albums/hooks";
import type { SelectAllAlbumFields } from "../../../api_client/albums/types";
import type { BulkPhotoQuery } from "../../../api_client/photos/types";
import { fuzzyMatch } from "../../../util/util";
import { AlbumListItem } from "../../album/AlbumListItem";
import { Tile } from "../../Tile";
import classes from "./AlbumEditModal.module.css";

type Props = Readonly<{
  isOpen: boolean;
  onRequestClose: () => void;
  // In select-all mode this holds the EXCLUDED items, not the selection.
  selectedImages: any[];
  selectAllMode?: boolean;
  selectAllQuery?: BulkPhotoQuery;
  totalCount?: number;
}>;

export function AlbumEditModal(props: Props) {
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const { isOpen, onRequestClose, selectedImages, selectAllMode = false, selectAllQuery, totalCount } = props;
  const { t } = useTranslation();
  const { data: albumsUserList = [] } = useFetchUserAlbumsQuery();
  const createUserAlbum = useCreateUserAlbumMutation();
  const addPhotoToUserAlbum = useAddPhotoToUserAlbumMutation();

  const excludedHashes = selectAllMode ? selectedImages.map(i => i.image_hash) : [];
  const effectiveCount = selectAllMode ? Math.max(0, (totalCount ?? 0) - selectedImages.length) : selectedImages.length;

  // The server resolves select-all through the same query the view uses (incl.
  // the photos/videos filter), so the payload matches exactly what is on screen.
  const selectAllFields: SelectAllAlbumFields = {
    select_all: true,
    query: selectAllQuery ?? {},
    excluded_hashes: excludedHashes,
    photoCount: effectiveCount,
  };

  return (
    <Modal
      zIndex={1500}
      opened={isOpen}
      title={<Title>{t("modalalbum.title")} </Title>}
      onClose={() => {
        onRequestClose();
        setNewAlbumTitle("");
      }}
    >
      <Stack>
        <Text c="dimmed">{t("modalalbum.selectedimages", { count: effectiveCount })}</Text>
        {selectAllMode ? (
          <Badge color="blue" size="lg" variant="light">
            {t("selectionbar.all")} {effectiveCount} {t("selectionbar.selected")}
            {excludedHashes.length > 0 && ` (${excludedHashes.length} ${t("selectionbar.excluded")})`}
          </Badge>
        ) : (
          <Group>
            {selectedImages.map(image => (
              <Tile
                key={`si-${image.id}`}
                className={classes.tile}
                height={40}
                width={40}
                image_hash={image.image_hash}
                video={image.type === "video"}
              />
            ))}
          </Group>
        )}
        <Divider />
        <Title order={4}>{t("modalalbum.newalbum")}</Title>
        <Group>
          <TextInput
            error={
              albumsUserList.map(el => el.title.toLowerCase().trim()).includes(newAlbumTitle.toLowerCase().trim())
                ? t("modalalbum.alreadyexists", { title: newAlbumTitle })
                : ""
            }
            onChange={v => {
              setNewAlbumTitle(v.currentTarget.value);
            }}
            placeholder={t("modalalbum.placeholder")}
          />
          <Button
            onClick={() => {
              createUserAlbum.mutate({
                title: newAlbumTitle,
                photos: selectAllMode ? [] : selectedImages.map(i => i.id),
                ...(selectAllMode ? selectAllFields : {}),
              });
              onRequestClose();
              setNewAlbumTitle("");
            }}
            disabled={albumsUserList
              .map(el => el.title.toLowerCase().trim())
              .includes(newAlbumTitle.toLowerCase().trim())}
            type="submit"
          >
            {t("modalalbum.create")}
          </Button>
        </Group>
        <Divider />
        <Stack className={classes.albums}>
          {albumsUserList
            .filter(el => fuzzyMatch(newAlbumTitle, el.title))
            .map(item => (
              <UnstyledButton
                key={`ub-${item.id}`}
                onClick={() => {
                  addPhotoToUserAlbum.mutate({
                    id: `${item.id}`,
                    title: item.title,
                    photos: selectAllMode ? [] : selectedImages.map(i => i.id),
                    ...(selectAllMode ? selectAllFields : {}),
                  });
                  onRequestClose();
                }}
              >
                <AlbumListItem album={item} showUpdatedTime />
              </UnstyledButton>
            ))}
        </Stack>
      </Stack>
    </Modal>
  );
}
