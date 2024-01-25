import { ActionIcon, Avatar, Divider, Group, Modal, ScrollArea, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconShare as Share, IconShareOff as ShareOff } from "@tabler/icons-react";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { setPhotosShared } from "../../actions/photosActions";
import { useFetchUserListQuery } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { i18nResolvedLanguage } from "../../i18n";
import { useAppDispatch, useAppSelector } from "../../store/store";
import classes from "./ModalAlbumShare.module.css";
import filterUsers from "./utils";

type Props = Readonly<{
  selectedImageHashes: any;
  isOpen: boolean;
  onRequestClose: () => void;
}>;

export function ModalPhotosShare(props: Props) {
  const { t } = useTranslation();
  const [userNameFilter, setUserNameFilter] = useState("");
  const { data: users = [], isFetching: isUsersLoading, isSuccess: isUsersLoaded } = useFetchUserListQuery();
  const { auth } = useAppSelector(store => store);
  const dispatch = useAppDispatch();
  const { selectedImageHashes, isOpen, onRequestClose } = props;

  const selectedImageSrcs = selectedImageHashes.map(
    (image_hash: string) => `${serverAddress}/media/square_thumbnails/${image_hash}`
  );

  return (
    <Modal
      opened={isOpen}
      title={<span className={classes.title}>{t("modalphotosshare.title")}</span>}
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

        {isUsersLoading && <div>{t("modalphotosshare.loading")}</div>}
        {isUsersLoaded && (
          <ScrollArea>
            <Stack>
              {filterUsers(userNameFilter, auth.access?.user_id, users).map(item => {
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
                          {DateTime.fromISO(item.date_joined).setLocale(i18nResolvedLanguage()).toRelative()}
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
        )}
      </Stack>
    </Modal>
  );
}
