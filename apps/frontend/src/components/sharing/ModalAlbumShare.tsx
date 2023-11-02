import { Divider, Modal, ScrollArea, Stack, TextInput, Title } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchUserAlbum } from "../../actions/albumsActions";
import { fetchPublicUserList } from "../../actions/publicActions";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { fuzzyMatch } from "../../util/util";
import { UserEntry } from "./UserEntry";

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
            {filteredUserList.length > 0 &&
              filteredUserList.map(item => <UserEntry key={item.id} item={item} albumID={albumID} />)}
          </Stack>
        </ScrollArea>
      </Stack>
    </Modal>
  );
}
