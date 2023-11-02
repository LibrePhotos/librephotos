import { Avatar, Divider, Group, Modal, ScrollArea, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { DateTime } from "luxon";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchUserAlbum, setUserAlbumShared } from "../../actions/albumsActions";
import { fetchPublicUserList } from "../../actions/publicActions";
import { i18nResolvedLanguage } from "../../i18n";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { fuzzyMatch } from "../../util/util";

type Props = {
  isOpen: boolean;
  onRequestClose: () => void;
  albumID: string;
};

export function ModalAlbumShare(props: Props) {
  const [userNameFilter, setUserNameFilter] = useState("");

  const { pub, auth } = useAppSelector(store => store);

  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const { isOpen, onRequestClose, albumID } = props;

  useEffect(() => {
    if (isOpen) {
      dispatch(fetchPublicUserList());
      dispatch(fetchUserAlbum(parseInt(albumID, 10)));
    }
  }, [isOpen, dispatch]);

  let filteredUserList;
  if (userNameFilter.length > 0) {
    filteredUserList = pub.publicUserList.filter(
      el => fuzzyMatch(userNameFilter, el.username) || fuzzyMatch(userNameFilter, `${el.first_name} ${el.last_name}`)
    );
  } else {
    filteredUserList = pub.publicUserList;
  }
  filteredUserList = filteredUserList.filter(el => el.id !== auth.access.user_id);

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
            {filteredUserList.length > 0 && filteredUserList.map(item => <UserEntry item={item} albumID={albumID} />)}
          </Stack>
        </ScrollArea>
      </Stack>
    </Modal>
  );
}

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
