import { Button, Divider, Group, Modal, Stack, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import _ from "lodash";
import * as moment from "moment";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { addToUserAlbum, createNewUserAlbum, fetchUserAlbumsList } from "../../actions/albumsActions";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { Tile } from "../Tile";

function fuzzy_match(str, pattern) {
  if (pattern.split("").length > 0) {
    pattern = pattern.split("").reduce((a, b) => `${a}.*${b}`);
    return new RegExp(pattern).test(str);
  }
  return false;
}

type Props = {
  isOpen: boolean;
  onRequestClose: () => void;
  selectedImageHashes: any[];
};

export const ModalAlbumEdit = (props: Props) => {
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const matches = useMediaQuery("(min-width: 700px)");
  const { albumsUserList } = useAppSelector(store => store.albums);
  const dispatch = useAppDispatch();
  const { isOpen, onRequestClose, selectedImageHashes } = props;
  const { t } = useTranslation();
  useEffect(() => {
    if (isOpen) {
      dispatch(fetchUserAlbumsList());
    }
  }, [isOpen]);

  let filteredUserAlbumList;
  if (newAlbumTitle.length > 0) {
    filteredUserAlbumList = albumsUserList.filter(el =>
      fuzzy_match(el.title.toLowerCase(), newAlbumTitle.toLowerCase())
    );
  } else {
    filteredUserAlbumList = albumsUserList;
  }
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
        <Text color="dimmed">{t("modalalbum.selectedimages", { count: selectedImageHashes.length })}</Text>
        <Group>
          {selectedImageHashes.map(image_hash => (
            <Tile style={{ objectFit: "cover" }} height={40} width={40} image_hash={image_hash} />
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
          ></TextInput>
          <Button
            onClick={() => {
              dispatch(createNewUserAlbum(newAlbumTitle, selectedImageHashes));
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
            filteredUserAlbumList.map(item => {
              return (
                <UnstyledButton
                  onClick={() => {
                    dispatch(addToUserAlbum(item.id, item.title, selectedImageHashes));
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
                        {
                          //@ts-ignore
                          `Updated ${moment(item.created_on).fromNow()}`
                        }
                      </Text>
                    </div>
                  </Group>
                </UnstyledButton>
              );
            })}
        </Stack>
      </Stack>
    </Modal>
  );
};
