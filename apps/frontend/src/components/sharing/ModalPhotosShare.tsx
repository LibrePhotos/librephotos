import { ActionIcon, Avatar, Divider, Group, Modal, ScrollArea, Stack, Text, TextInput, Title } from "@mantine/core";
import { DateTime } from "luxon";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share, ShareOff } from "tabler-icons-react";

import { setPhotosShared } from "../../actions/photosActions";
import { fetchPublicUserList } from "../../actions/publicActions";
import { serverAddress } from "../../api_client/apiClient";
import i18n from "../../i18n";
import { useAppDispatch, useAppSelector } from "../../store/store";

function fuzzyMatch(str: string, pattern: string) {
  if (pattern.split("").length > 0) {
    const expr = pattern.split("").reduce((a, b) => `${a}.*${b}`);
    return new RegExp(expr).test(str);
  }
  return false;
}

type Props = {
  selectedImageHashes: any;
  isOpen: boolean;
  onRequestClose: () => void;
};

export function ModalPhotosShare(props: Props) {
  const { t } = useTranslation();
  const [userNameFilter, setUserNameFilter] = useState("");

  const { auth, pub } = useAppSelector(store => store);
  const dispatch = useAppDispatch();

  const { selectedImageHashes, isOpen, onRequestClose } = props;
  let filteredUserList: any[];
  if (userNameFilter.length > 0) {
    filteredUserList = pub.publicUserList.filter(
      (el: any) =>
        fuzzyMatch(el.username.toLowerCase(), userNameFilter.toLowerCase()) ||
        fuzzyMatch(`${el.first_name.toLowerCase()} ${el.last_name.toLowerCase()}`, userNameFilter.toLowerCase())
    );
  } else {
    filteredUserList = pub.publicUserList;
  }
  filteredUserList = filteredUserList.filter((el: any) => el.id !== auth.access?.user_id);

  const selectedImageSrcs = selectedImageHashes.map(
    (image_hash: string) => `${serverAddress}/media/square_thumbnails/${image_hash}`
  );

  useEffect(() => {
    if (isOpen) {
      dispatch(fetchPublicUserList());
    }
  }, [isOpen, dispatch]);

  return (
    <Modal
      opened={isOpen}
      title={<Title>{t("modalphotosshare.title")}</Title>}
      onClose={() => {
        onRequestClose();
        setUserNameFilter("");
      }}
    >
      <Stack>
        <ScrollArea>
          <Group>
            {selectedImageSrcs.slice(0, 100).map((image: string) => (
              <Avatar key={`selected_image${image}`} size={40} src={image} />
            ))}
          </Group>
        </ScrollArea>
        <Divider />
        <Title order={4}>{t("modalphotosshare.search")}</Title>
        <TextInput
          onChange={event => {
            setUserNameFilter(event.currentTarget.value);
          }}
          placeholder={t("modalphotosshare.name")}
        />
        <Divider />

        <ScrollArea>
          <Stack>
            {filteredUserList.length > 0 &&
              filteredUserList.map(item => {
                let displayName = item.username;
                if (item.first_name.length > 0 && item.last_name.length > 0) {
                  displayName = `${item.first_name} ${item.last_name}`;
                }
                const avatar = item.avatar ? item.avatar_url : "/unknown_user.jpg";
                return (
                  <Group position="apart" key={item.id}>
                    <Group>
                      <Avatar radius="xl" size={50} src={avatar} />
                      <div>
                        <Title order={4}>{displayName}</Title>
                        <Text size="sm" color="dimmed">
                          {t("modalphotosshare.joined")}{" "}
                          {DateTime.fromISO(item.date_joined)
                            .setLocale(i18n.resolvedLanguage.replace("_", "-"))
                            .toRelative()}
                        </Text>
                      </div>
                    </Group>
                    <Group>
                      <ActionIcon
                        onClick={() => {
                          dispatch(setPhotosShared(selectedImageHashes, true, item));
                        }}
                        color="green"
                      >
                        <Share />
                      </ActionIcon>
                      <ActionIcon
                        onClick={() => {
                          dispatch(setPhotosShared(selectedImageHashes, false, item));
                        }}
                        color="red"
                      >
                        <ShareOff />
                      </ActionIcon>
                    </Group>
                  </Group>
                );
              })}
          </Stack>
        </ScrollArea>
      </Stack>
    </Modal>
  );
}
