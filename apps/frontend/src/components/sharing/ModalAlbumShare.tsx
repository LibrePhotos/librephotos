import { Divider, Modal, ScrollArea, Stack, TextInput, Title } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { useFetchUserListQuery } from "../../api_client/api";
import { useAppSelector } from "../../store/store";
import classes from "./ModalAlbumShare.module.css";
import { UserEntry } from "./UserEntry";
import filterUsers from "./utils";

type Props = Readonly<{
  isOpen: boolean;
  onRequestClose: () => void;
  albumID: string;
}>;

export function ModalAlbumShare(props: Props) {
  const [userNameFilter, setUserNameFilter] = useState("");
  const { auth } = useAppSelector(store => store);
  const { t } = useTranslation();
  const { isOpen, onRequestClose, albumID } = props;
  const { data: users, isFetching: isUsersFetching, isSuccess: isUsersLoaded } = useFetchUserListQuery();

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
        <Title order={4}>{t("modalphotosshare.search")}</Title>
        <TextInput
          onChange={event => {
            setUserNameFilter(event.currentTarget.value);
          }}
          placeholder={t("modalphotosshare.name")}
        />
        <Divider />
        {isUsersFetching && <div>{t("modalphotosshare.loading")}</div>}
        {isUsersLoaded && (
          <ScrollArea>
            <Stack>
              {filterUsers(userNameFilter, auth.access?.user_id, users).map(item => (
                <UserEntry key={item.id} item={item} albumID={albumID} />
              ))}
            </Stack>
          </ScrollArea>
        )}
      </Stack>
    </Modal>
  );
}
