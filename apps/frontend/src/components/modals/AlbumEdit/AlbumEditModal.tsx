import { Button, Divider, Group, Modal, Stack, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAddPhotoToUserAlbumMutation,
  useCreateUserAlbumMutation,
  useFetchUserAlbumsQuery,
} from "../../../api_client/albums/hooks";
import { fuzzyMatch } from "../../../util/util";
import { AlbumListItem } from "../../album/AlbumListItem";
import { Tile } from "../../Tile";
import classes from "./AlbumEditModal.module.css";

type Props = Readonly<{
  isOpen: boolean;
  onRequestClose: () => void;
  selectedImages: any[];
}>;

export function AlbumEditModal(props: Props) {
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const { isOpen, onRequestClose, selectedImages } = props;
  const { t } = useTranslation();
  const { data: albumsUserList = [] } = useFetchUserAlbumsQuery();
  const createUserAlbum = useCreateUserAlbumMutation();
  const addPhotoToUserAlbum = useAddPhotoToUserAlbumMutation();

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
        <Text c="dimmed">{t("modalalbum.selectedimages", { count: selectedImages.length })}</Text>
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
                photos: selectedImages.map(i => i.image_hash),
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
                    photos: selectedImages.map(i => i.image_hash),
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
