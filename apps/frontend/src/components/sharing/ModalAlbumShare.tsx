import { Avatar, Divider, Group, Modal, ScrollArea, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { DateTime } from "luxon";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share } from "tabler-icons-react";

import { setUserAlbumShared } from "../../actions/albumsActions";
import { fetchPublicUserList } from "../../actions/publicActions";
import i18n from "../../i18n";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { fuzzyMatch } from "../../util/util";

type Props = {
  isOpen: boolean;
  onRequestClose: () => void;
  albumID: string;
};
// To-Do: Add missing locales
export function ModalAlbumShare(props: Props) {
  const [userNameFilter, setUserNameFilter] = useState("");

  const { pub, auth } = useAppSelector(store => store);
  const { albumDetails } = useAppSelector(store => store.albums);

  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const { isOpen, onRequestClose, albumID } = props;

  useEffect(() => {
    if (isOpen) {
      dispatch(fetchPublicUserList());
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
      zIndex={1500}
      opened={isOpen}
      title={<Title>Share Album</Title>}
      onClose={() => {
        onRequestClose();
        setUserNameFilter("");
      }}
    >
      <Stack>
        <Title order={4}>Search user</Title>
        <TextInput
          onChange={event => {
            setUserNameFilter(event.currentTarget.value);
          }}
          placeholder="Person name"
        />
        <Divider />
        <ScrollArea>
          {filteredUserList.length > 0 &&
            filteredUserList.map(item => {
              const displayName =
                item.first_name.length > 0 && item.last_name.length > 0
                  ? `${item.first_name} ${item.last_name}`
                  : item.username;
              return (
                <Group key={item.id}>
                  <Avatar radius="xl" size={60} src="/unknown_user.jpg" />
                  <Title
                    order={4}
                    onClick={() => {
                      dispatch(setUserAlbumShared(parseInt(albumID, 10), item.id, true));
                      onRequestClose();
                    }}
                  >
                    {albumDetails.shared_to && albumDetails.shared_to.map(e => e.id).includes(item.id) && (
                      <Group style={{ cursor: "pointer" }}>
                        {displayName}
                        <Share />
                      </Group>
                    )}
                  </Title>
                  <Text size="sm" color="dimmed">
                    {t("modalphotosshare.joined")}{" "}
                    {DateTime.fromISO(item.date_joined).setLocale(i18n.resolvedLanguage.replace("_", "-")).toRelative()}
                  </Text>
                  <Switch
                    checked={albumDetails.shared_to && albumDetails.shared_to.map(e => e.id).includes(item.id)}
                    onChange={() => {
                      dispatch(
                        setUserAlbumShared(
                          parseInt(albumID, 10),
                          item.id,
                          !albumDetails.shared_to.map(e => e.id).includes(item.id)
                        )
                      );
                    }}
                  />
                </Group>
              );
            })}
        </ScrollArea>
      </Stack>
    </Modal>
  );
}
