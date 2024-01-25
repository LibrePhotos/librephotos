import { Avatar, Group, Switch, Text, Title } from "@mantine/core";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";

import { useShareUserAlbumMutation } from "../../api_client/albums/sharing";
import type { UserAlbum } from "../../api_client/albums/types";
import { useFetchUserAlbumQuery } from "../../api_client/albums/user";
import { i18nResolvedLanguage } from "../../i18n";
import type { IUser } from "../../store/user/user.zod";

type UserEntryProps = Readonly<{
  item: IUser;
  albumID: string;
}>;

function getDisplayName(item: IUser) {
  return item.first_name.length > 0 && item.last_name.length > 0
    ? `${item.first_name} ${item.last_name}`
    : item.username;
}

function getAvatar(item: IUser) {
  return item.avatar ? item.avatar_url : "/unknown_user.jpg";
}

function isShared(album: UserAlbum, user: IUser) {
  return album?.shared_to.map(sUser => sUser.id).includes(user.id);
}

export function UserEntry(props: UserEntryProps) {
  const { item: user, albumID } = props;
  const { t } = useTranslation();
  const { data: albumDetails } = useFetchUserAlbumQuery(albumID);
  const [shareUserAlbum] = useShareUserAlbumMutation();

  return (
    <Group position="apart" key={user.id}>
      <Group>
        <Avatar radius="xl" size={50} src={getAvatar(user)} />
        <div>
          <Title order={4}>{getDisplayName(user)}</Title>
          <Text size="sm" color="dimmed">
            {t("modalphotosshare.joined")}{" "}
            {DateTime.fromISO(user.date_joined).setLocale(i18nResolvedLanguage()).toRelative()}
          </Text>
        </div>
      </Group>
      <Group>
        <Switch
          checked={isShared(albumDetails!, user)}
          onChange={() => {
            shareUserAlbum({
              albumId: albumID,
              userId: `${user.id}`,
              share: !albumDetails?.shared_to.map(e => e.id).includes(user.id),
            });
          }}
        />
      </Group>
    </Group>
  );
}
