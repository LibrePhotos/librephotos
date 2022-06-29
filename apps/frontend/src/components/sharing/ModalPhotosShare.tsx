import { ActionIcon, Avatar, Divider, Group, Modal, ScrollArea, Stack, Text, TextInput, Title } from "@mantine/core";
import moment from "moment";
import React, { useEffect, useState } from "react";
import { Share, ShareOff } from "tabler-icons-react";

import { setPhotosShared } from "../../actions/photosActions";
import { fetchPublicUserList } from "../../actions/publicActions";
import { serverAddress } from "../../api_client/apiClient";
import { useAppDispatch, useAppSelector } from "../../store/store";

function fuzzy_match(str, pattern) {
  if (pattern.split("").length > 0) {
    pattern = pattern.split("").reduce((a, b) => `${a}.*${b}`);
    return new RegExp(pattern).test(str);
  }
  return false;
}

type Props = {
  selectedImageHashes: any;
  isOpen: boolean;
  onRequestClose: () => void;
};
//To-Do: Add missing locales
export const ModalPhotosShare = (props: Props) => {
  const [userNameFilter, setUserNameFilter] = useState("");
  const [valShare, setValShare] = useState(false);

  const { auth, pub } = useAppSelector(store => store);
  const dispatch = useAppDispatch();

  const { selectedImageHashes, isOpen, onRequestClose } = props;
  let filteredUserList;
  if (userNameFilter.length > 0) {
    filteredUserList = pub.publicUserList.filter(
      el =>
        fuzzy_match(el.username.toLowerCase(), userNameFilter.toLowerCase()) ||
        fuzzy_match(`${el.first_name.toLowerCase()} ${el.last_name.toLowerCase()}`, userNameFilter.toLowerCase())
    );
  } else {
    filteredUserList = pub.publicUserList;
  }
  filteredUserList = filteredUserList.filter(el => el.id !== auth.access.user_id);

  const selectedImageSrcs = selectedImageHashes.map(
    image_hash => `${serverAddress}/media/square_thumbnails/${image_hash}`
  );

  useEffect(() => {
    if (isOpen) {
      dispatch(fetchPublicUserList());
    }
  }, [isOpen, dispatch]);

  return (
    <Modal
      zIndex={1500}
      opened={isOpen}
      title={<Title>Share Photos</Title>}
      onClose={() => {
        onRequestClose();
        setUserNameFilter("");
      }}
    >
      <Stack>
        <Text color="dimmed">
          {valShare ? "Share " : "Unshare "} selected {selectedImageHashes.length} photo(s) with...
        </Text>
        <Divider />
        <ScrollArea>
          <Group>
            {selectedImageSrcs.slice(0, 100).map(image => (
              <Avatar key={`selected_image${image}`} size={40} src={image} />
            ))}
          </Group>
        </ScrollArea>
        <Divider />
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
              var displayName = item.username;
              if (item.first_name.length > 0 && item.last_name.length > 0) {
                displayName = `${item.first_name} ${item.last_name}`;
              }
              return (
                <Group position="apart" key={item.id}>
                  <Group>
                    <Avatar radius="xl" size={50} src="/unknown_user.jpg" />
                    <Stack spacing="xs">
                      <Title order={4}>{displayName}</Title>
                      <Text size="sm" color="dimmed">
                        Joined {moment(item.date_joined).format("MMMM YYYY")}
                      </Text>
                    </Stack>
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
        </ScrollArea>
      </Stack>
    </Modal>
  );
};
