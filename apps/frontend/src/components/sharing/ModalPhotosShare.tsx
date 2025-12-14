import { ActionIcon, Avatar, Badge, Divider, Group, Modal, ScrollArea, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconShare as Share, IconShareOff as ShareOff } from "@tabler/icons-react";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { serverAddress } from "../../api_client/apiClient";
import { useUpdatePhotoSharingMutation } from "../../api_client/photos/hooks";
import type { BulkPhotoQuery } from "../../api_client/photos/types";
import { i18nResolvedLanguage } from "../../i18n";
import classes from "./ModalAlbumShare.module.css";
import filterUsers from "./utils";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";

type Props = Readonly<{
  selectedImageHashes: string[];
  isOpen: boolean;
  onRequestClose: () => void;
  selectAllMode?: boolean;
  selectAllQuery?: BulkPhotoQuery;
}>;

export function ModalPhotosShare(props: Props) {
  const { t } = useTranslation();
  const [userNameFilter, setUserNameFilter] = useState("");
  const { data: users = [], isFetching: isUsersLoading, isSuccess: isUsersLoaded } = useFetchUserListQuery();
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  const {
    selectedImageHashes,
    isOpen,
    onRequestClose,
    selectAllMode = false,
    selectAllQuery,
  } = props;
  const { mutate: updatePhotoSharing } = useUpdatePhotoSharingMutation();

  // In selectAllMode, selectedImageHashes contains exclusions
  const excludedHashes = selectAllMode ? selectedImageHashes : [];

  // Only show preview images in non-selectAll mode
  const selectedImageSrcs = selectAllMode
    ? []
    : selectedImageHashes.map(
        (image_hash: string) => `${serverAddress}/media/square_thumbnails/${image_hash}`
      );

  const handleShare = (targetUser: typeof users[0], share: boolean) => {
    if (selectAllMode) {
      updatePhotoSharing({
        select_all: true,
        query: selectAllQuery ?? {},
        excluded_hashes: excludedHashes,
        val_shared: share,
        target_user: targetUser,
      });
    } else {
      updatePhotoSharing({
        image_hashes: selectedImageHashes,
        val_shared: share,
        target_user: targetUser,
      });
    }
  };

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
        {selectAllMode ? (
          <Badge color="blue" size="lg" variant="light">
            {t("selectionbar.all")} {excludedHashes.length > 0 && `(${excludedHashes.length} ${t("selectionbar.excluded")})`}
          </Badge>
        ) : (
          <ScrollArea>
            <Group>
              {selectedImageSrcs.slice(0, 100).map((image: string) => (
                <Avatar key={`selected_image${image}`} size={40} src={image} />
              ))}
            </Group>
          </ScrollArea>
        )}
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
              {filterUsers(userNameFilter, currentUser?.id ?? 0, users).map(item => {
                let displayName = item.username;
                if (item.first_name.length > 0 && item.last_name.length > 0) {
                  displayName = `${item.first_name} ${item.last_name}`;
                }
                const avatar = item.avatar ? item.avatar_url : "/unknown_user.jpg";
                return (
                  <Group justify="apart" key={item.id}>
                    <Group>
                      <Avatar radius="xl" size={50} src={avatar} />
                      <div>
                        <Title order={4}>{displayName}</Title>
                        <Text size="sm" c="dimmed">
                          {t("modalphotosshare.joined")}{" "}
                          {DateTime.fromISO(item.date_joined).setLocale(i18nResolvedLanguage()).toRelative()}
                        </Text>
                      </div>
                    </Group>
                    <Group>
                      <ActionIcon
                        onClick={() => handleShare(item, true)}
                        color="green"
                      >
                        <Share />
                      </ActionIcon>
                      <ActionIcon
                        onClick={() => handleShare(item, false)}
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
