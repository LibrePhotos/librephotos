import _ from "lodash";
import * as moment from "moment";
import React, { Component } from "react";
import Modal from "react-modal";
// only needs to be imported once
import { connect } from "react-redux";
import "react-virtualized/styles.css";
import { Button, Divider, Header, Image, Input, Popup } from "semantic-ui-react";

import { addToUserAlbum, createNewUserAlbum, fetchUserAlbumsList } from "../../actions/albumsActions";
import { serverAddress } from "../../api_client/apiClient";

function fuzzy_match(str, pattern) {
  if (pattern.split("").length > 0) {
    pattern = pattern.split("").reduce((a, b) => `${a}.*${b}`);
    return new RegExp(pattern).test(str);
  }
  return false;
}

const customStyles = {
  content: {
    top: "12vh",
    left: "8vh",
    right: "8vh",
    height: "65vh",
    display: "flex",
    flexFlow: "column",
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

export class ModalAlbumEdit extends Component {
  state = { newAlbumTitle: "" };

  render() {
    let filteredUserAlbumList;
    if (this.state.newAlbumTitle.length > 0) {
      filteredUserAlbumList = this.props.albumsUserList.filter(el =>
        fuzzy_match(el.title.toLowerCase(), this.state.newAlbumTitle.toLowerCase())
      );
    } else {
      filteredUserAlbumList = this.props.albumsUserList;
    }
    return (
      <Modal
        ariaHideApp={false}
        onAfterOpen={() => {
          this.props.dispatch(fetchUserAlbumsList());
        }}
        isOpen={this.props.isOpen}
        onRequestClose={() => {
          this.props.onRequestClose();
          this.setState({ newAlbumTitle: "" });
        }}
        style={customStyles}
      >
        <div style={{ height: 50, width: "100%", padding: 7 }}>
          <Header>
            <Header.Content>
              Add to Album
              <Header.Subheader>Add selected {this.props.selectedImageHashes.length} photo(s) to...</Header.Subheader>
            </Header.Content>
          </Header>
        </div>
        <Divider fitted />
        <div style={{ padding: 5, height: 50, overflowY: "hidden" }}>
          <Image.Group>
            {this.props.selectedImageHashes.map(image_hash => (
              <Image
                style={{ objectFit: "cover" }}
                height={40}
                width={40}
                src={`${serverAddress}/media/square_thumbnails/${image_hash}`}
              />
            ))}
          </Image.Group>
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
            <Header as="h4">New album</Header>
            <Popup
              inverted
              content={`Album "${this.state.newAlbumTitle.trim()}" already exists.`}
              position="bottom center"
              open={this.props.albumsUserList
                .map(el => el.title.toLowerCase().trim())
                .includes(this.state.newAlbumTitle.toLowerCase().trim())}
              trigger={
                <Input
                  fluid
                  error={this.props.albumsUserList
                    .map(el => el.title.toLowerCase().trim())
                    .includes(this.state.newAlbumTitle.toLowerCase().trim())}
                  onChange={(e, v) => {
                    this.setState({ newAlbumTitle: v.value });
                  }}
                  placeholder="Album title"
                  action
                >
                  <input />
                  <Button
                    positive
                    onClick={() => {
                      this.props.dispatch(createNewUserAlbum(this.state.newAlbumTitle, this.props.selectedImageHashes));
                      this.props.onRequestClose();
                      this.setState({ newAlbumTitle: "" });
                    }}
                    disabled={this.props.albumsUserList
                      .map(el => el.title.toLowerCase().trim())
                      .includes(this.state.newAlbumTitle.toLowerCase().trim())}
                    type="submit"
                  >
                    Create
                  </Button>
                </Input>
              }
            />
          </div>
          <Divider />
          {filteredUserAlbumList.length > 0 &&
            filteredUserAlbumList.map(item => (
              <div
                key={`useralbum_${item.id}`}
                style={{
                  height: 70,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Header
                  onClick={() => {
                    this.props.dispatch(addToUserAlbum(item.id, item.title, this.props.selectedImageHashes));
                    this.props.onRequestClose();
                  }}
                  as="a"
                >
                  <Image
                    height={50}
                    width={50}
                    style={{ objectFit: "cover" }}
                    src={
                      item.cover_photos[0]
                        ? `${serverAddress}/media/thumbnails_big/${item.cover_photos[0].image_hash}`
                        : "/thumbnail_placeholder.png"
                    }
                  />
                  <Header.Content>
                    {item.title}
                    <Header.Subheader>
                      {item.photo_count} Item(s) <br />
                      {`Updated ${moment(item.created_on).fromNow()}`}
                    </Header.Subheader>
                  </Header.Content>
                </Header>
              </div>
            ))}
        </div>
      </Modal>
    );
  }
}

ModalAlbumEdit = connect(store => ({
  albumsUserList: store.albums.albumsUserList,
  fetchingAlbumsUserList: store.albums.fetchingAlbumsUserList,
  fetchedAlbumsUserList: store.albums.fetchedAlbumsUserList,
}))(ModalAlbumEdit);
