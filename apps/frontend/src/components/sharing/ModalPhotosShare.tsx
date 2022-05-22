import { Avatar, Group, Image } from "@mantine/core";
import moment from "moment";
import React, { useState } from "react";
import Modal from "react-modal";
import { connect } from "react-redux";
import { Button, Divider, Header, Icon, Input } from "semantic-ui-react";

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

const modalStyles = {
  content: {
    top: 150,
    left: 40,
    right: 40,
    height: window.innerHeight - 300,

    overflow: "hidden",
    padding: 0,
    backgroundColor: "white",
  },
  overlay: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    position: "fixed",
    borderRadius: 0,
    border: 0,
    zIndex: 102,
    backgroundColor: "rgba(200,200,200,0.8)",
  },
};

type Props = {
  selectedImageHashes: any;
  isOpen: boolean;
  onRequestClose: () => void;
};

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

  return (
    <Modal
      ariaHideApp={false}
      onAfterOpen={() => {
        dispatch(fetchPublicUserList());
      }}
      isOpen={isOpen}
      onRequestClose={() => {
        onRequestClose();
        setUserNameFilter("");
      }}
      // @ts-ignore
      style={modalStyles}
    >
      <div style={{ height: 50, width: "100%", padding: 7 }}>
        <Header>
          {valShare ? "Share Photos" : "Unshare Photos"}
          <Header.Subheader>
            {valShare ? "Share " : "Unshare "} selected {selectedImageHashes.length} photo(s) with...
          </Header.Subheader>
        </Header>
      </div>
      <Divider fitted />
      <div style={{ padding: 5, height: 50, overflowY: "hidden" }}>
        <Group>
          {selectedImageSrcs.slice(0, 100).map(image => (
            <Image key={`selected_image${image}`} height={40} src={image} />
          ))}
        </Group>
      </div>
      <Divider fitted />
      <div
        style={{
          paddingLeft: 10,
          paddingTop: 10,
          overflowY: "scroll",
          height: window.innerHeight - 300 - 100,
          width: "100%",
        }}
      >
        <div style={{ paddingRight: 5 }}>
          <Header as="h4">Search user</Header>
          <Input
            fluid
            onChange={(e, v) => {
              setUserNameFilter(v.value);
            }}
            placeholder="Person name"
          />
        </div>
        <Divider />
        {filteredUserList.length > 0 &&
          filteredUserList.map(item => {
            var displayName = item.username;
            if (item.first_name.length > 0 && item.last_name.length > 0) {
              displayName = `${item.first_name} ${item.last_name}`;
            }
            return (
              <div
                key={`modal_photos_share_user_${item.username}`}
                style={{
                  height: 70,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Header floated="left" as="h4" onClick={() => {}}>
                  <Avatar radius="xl" src="/unknown_user.jpg" />
                  <Header.Content>
                    {displayName}
                    <Header.Subheader>Joined {moment(item.date_joined).format("MMMM YYYY")}</Header.Subheader>
                  </Header.Content>
                </Header>
                <Header floated="right" as="h5">
                  <Button.Group size="mini" compact>
                    <Button
                      onClick={() => {
                        dispatch(setPhotosShared(selectedImageHashes, true, item));
                      }}
                      positive
                      icon
                    >
                      <Icon name="linkify" />
                      Share
                    </Button>
                    <Button.Or />
                    <Button
                      onClick={() => {
                        dispatch(setPhotosShared(selectedImageHashes, false, item));
                      }}
                      negative
                      icon
                    >
                      <Icon name="linkify" />
                      Unshare
                    </Button>
                  </Button.Group>
                </Header>
              </div>
            );
          })}
      </div>
    </Modal>
  );
};
