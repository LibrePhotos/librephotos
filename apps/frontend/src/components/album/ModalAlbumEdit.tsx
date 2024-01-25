import { Button, Divider, Group, Modal, Stack, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { DateTime } from "luxon";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  useAddPhotoToUserAlbumMutation,
  useCreateUserAlbumMutation,
  useFetchUserAlbumsQuery,
} from "../../api_client/albums/user";
import { i18nResolvedLanguage } from "../../i18n";
import { fuzzyMatch } from "../../util/util";
import { Tile } from "../Tile";

type Props = Readonly<{
  isOpen: boolean;
  onRequestClose: () => void;
  selectedImages: any[];
}>;

export function ModalAlbumEdit(props: Props) {
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const matches = useMediaQuery("(min-width: 700px)");
  const { isOpen, onRequestClose, selectedImages } = props;
  const { t } = useTranslation();
  const { data: albumsUserList = [] } = useFetchUserAlbumsQuery();
  const [createUserAlbum] = useCreateUserAlbumMutation();
  const [addPhotoToUserAlbum] = useAddPhotoToUserAlbumMutation();
  const [filteredUserAlbumList, setFilteredUserAlbumList] = useState(albumsUserList);

  useEffect(() => {
    setFilteredUserAlbumList(albumsUserList.filter(el => fuzzyMatch(newAlbumTitle, el.title)));
  }, [newAlbumTitle, albumsUserList]);

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
        <Text color="dimmed">{t("modalalbum.selectedimages", { count: selectedImages.length })}</Text>
        <Group>
          {selectedImages.map(image => (
            <Tile
              key={`si-${image.id}`}
              style={{ objectFit: "cover" }}
              height={40}
              width={40}
              image_hash={image.id}
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
              createUserAlbum({
                title: newAlbumTitle,
                photos: selectedImages.map(i => i.id),
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
        <Stack style={{ height: matches ? "50vh" : "25vh", overflowY: "scroll" }}>
          {filteredUserAlbumList.length > 0 &&
            filteredUserAlbumList.map(item => (
              <UnstyledButton
                key={`ub-${item.id}`}
                onClick={() => {
                  addPhotoToUserAlbum({
                    id: `${item.id}`,
                    title: item.title,
                    photos: selectedImages.map(i => i.id),
                  });
                  onRequestClose();
                }}
              >
                <Group>
                  <Tile
                    height={50}
                    width={50}
                    style={{ objectFit: "cover" }}
                    image_hash={item.cover_photo.image_hash}
                    video={item.cover_photo.video}
                  />
                  <div>
                    <Title order={4}>{item.title}</Title>
                    <Text size="sm" color="dimmed">
                      {t("modalalbum.items", { count: item.photo_count })}
                      <br />
                      {t("modalalbum.updated", {
                        duration: DateTime.fromISO(item.created_on).setLocale(i18nResolvedLanguage()).toRelative(),
                      })}
                      {}
                    </Text>
                  </div>
                </Group>
              </UnstyledButton>
            ))}
        </Stack>
      </Stack>
    </Modal>
  );
}
