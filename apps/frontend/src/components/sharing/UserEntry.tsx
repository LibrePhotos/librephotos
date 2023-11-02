import { Avatar, Group, Switch, Text, Title } from "@mantine/core";
import { DateTime } from "luxon";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { setUserAlbumShared } from "../../actions/albumsActions";
import { i18nResolvedLanguage } from "../../i18n";
import { useAppDispatch, useAppSelector } from "../../store/store";

type UserEntryProps = {
  item: any;
  albumID: string;
};

export function UserEntry(props: UserEntryProps) {
  const { item, albumID } = props;
  const { albumDetails } = useAppSelector(store => store.albums);

  const [isShared, setIsShared] = useState(
    albumDetails.shared_to && albumDetails.shared_to.map(e => e.id).includes(item.id)
  );
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  useEffect(() => {
    setIsShared(albumDetails.shared_to && albumDetails.shared_to.map(e => e.id).includes(item.id));
  }, [albumDetails]);

  const displayName =
    item.first_name.length > 0 && item.last_name.length > 0 ? `${item.first_name} ${item.last_name}` : item.username;
  const avatar = item.avatar ? item.avatar_url : "/unknown_user.jpg";

  return (
    <Group position="apart" key={item.id}>
      <Group>
        <Avatar radius="xl" size={50} src={avatar} />
        <div>
          <Title order={4}>{displayName}</Title>
          <Text size="sm" color="dimmed">
            {t("modalphotosshare.joined")}{" "}
            {DateTime.fromISO(item.date_joined).setLocale(i18nResolvedLanguage).toRelative()}
          </Text>
        </div>
      </Group>
      <Group>
        <Switch
          checked={isShared}
          onChange={() => {
            dispatch(
              setUserAlbumShared(
                parseInt(albumID, 10),
                item.id,
                !albumDetails.shared_to.map(e => e.id).includes(item.id)
              )
            );
            setIsShared(!isShared);
          }}
        />
      </Group>
    </Group>
  );
}
