import React, { Component } from "react";
import "react-virtualized/styles.css"; // only needs to be imported once
import {
  setPhotosFavorite,
  setPhotosHidden,
  setPhotosPublic,
  downloadPhotos,
} from "../../actions/photosActions";

import { removeFromUserAlbum } from "../../actions/albumsActions";
import { copyToClipboard } from "../../util/util";
import { Dropdown, Popup, Button, Icon } from "semantic-ui-react";
import { serverAddress } from "../../api_client/apiClient";
import _ from "lodash";

export default function getToolbar(photoList) {
  return (
    <Button.Group
      style={{ paddingLeft: 2, paddingRight: 2 }}
      compact
      floated="right"
      color="orange"
    >
      <Dropdown
        icon="ellipsis vertical"
        pointing="top right"
        floating
        button
        compact
        floated="right"
        className="icon"
        color="blue"
      >
        <Dropdown.Menu>
          <Dropdown.Header>
            <Icon name="image" />
            Photo Actions ({photoList.state.selectedItems.length} selected)
          </Dropdown.Header>

          <Dropdown.Divider />
          <Dropdown.Item
            disabled={photoList.state.selectedItems.length === 0}
            onClick={() => {
              photoList.props.dispatch(
                setPhotosFavorite(
                  photoList.state.selectedItems.map((i) => i.id),
                  true
                )
              );
            }}
          >
            <Icon name="star" color="yellow" />
            {"  Favorite"}
          </Dropdown.Item>
          <Dropdown.Item
            disabled={photoList.state.selectedItems.length === 0}
            onClick={() => {
              photoList.props.dispatch(
                setPhotosFavorite(
                  photoList.state.selectedItems.map((i) => i.id),
                  false
                )
              );
            }}
          >
            <Icon name="star outline" color="yellow" />
            {"  Unfavorite"}
          </Dropdown.Item>

          <Dropdown.Divider />
          <Dropdown.Item
            disabled={photoList.state.selectedItems.length === 0}
            onClick={() => {
              photoList.props.dispatch(
                setPhotosHidden(
                  photoList.state.selectedItems.map((i) => i.id),
                  true
                )
              );
            }}
          >
            <Icon name="hide" color="red" />
            {"  Hide"}
          </Dropdown.Item>
          <Dropdown.Item
            disabled={photoList.state.selectedItems.length === 0}
            onClick={() => {
              photoList.props.dispatch(
                setPhotosHidden(
                  photoList.state.selectedItems.map((i) => i.id),
                  false
                )
              );
            }}
          >
            <Icon name="unhide" color="black" />
            {"  Unhide"}
          </Dropdown.Item>

          <Dropdown.Divider />
          <Dropdown.Item
            disabled={photoList.state.selectedItems.length === 0}
            onClick={() => {
              photoList.props.dispatch(
                setPhotosPublic(
                  photoList.state.selectedItems.map((i) => i.id),
                  true
                )
              );
              const linksToCopy = photoList.state.selectedItems
                .map((i) => i.id)
                .map((ih) => serverAddress + "/media/photos/" + ih + ".jpg")
                .join("\n");
              copyToClipboard(linksToCopy);
            }}
          >
            <Icon name="globe" />
            {"  Make Public"}
          </Dropdown.Item>
          <Dropdown.Item
            disabled={photoList.state.selectedItems.length === 0}
            onClick={() => {
              photoList.props.dispatch(
                setPhotosPublic(
                  photoList.state.selectedItems.map((i) => i.id),
                  false
                )
              );
            }}
          >
            <Icon name="key" />
            {"  Make Private"}
          </Dropdown.Item>

          <Dropdown.Divider />
          <Dropdown.Item
            disabled={photoList.state.selectedItems.length === 0}
            onClick={() => {
              photoList.props.dispatch(
                downloadPhotos(photoList.state.selectedItems.map((i) => i.id))
              );
            }}
          >
            <Icon name="download" />
            {"  Download"}
          </Dropdown.Item>

          <Dropdown.Divider />
          <Popup
            inverted
            position="left center"
            trigger={
              <Dropdown.Item
                disabled={photoList.state.selectedItems.length === 0}
                onClick={() => {
                  if (photoList.state.selectedItems.length > 0) {
                    photoList.setState({ modalSharePhotosOpen: true });
                  }
                }}
              >
                <Icon name="share" />
                {"  Sharing"}
              </Dropdown.Item>
            }
            content="Open sharing panel for selected photos"
          />
          <Dropdown.Divider />
          <Dropdown.Header>
            <Icon name="images" />
            Album Actions
          </Dropdown.Header>
          <Popup
            inverted
            position="left center"
            trigger={
              <Dropdown.Item
                disabled={
                  !photoList.props.route.location.pathname.startsWith(
                    "/useralbum/"
                  )
                }
                onClick={() => {
                  photoList.setState({ modalAlbumShareOpen: true });
                }}
              >
                <Icon name="share" />
                {"  Sharing"}
              </Dropdown.Item>
            }
            content="Open sharing panel for the current album"
          />
          <Popup
            inverted
            position="left center"
            trigger={
              <Dropdown.Item
                disabled={
                  !photoList.props.route.location.pathname.startsWith(
                    "/useralbum/" || photoList.state.selectedItems.length == 0
                  )
                }
                onClick={() => {
                  var id = photoList.props.match.params.albumID;
                  console.log("albumID:" + id);
                  photoList.props.dispatch(
                    removeFromUserAlbum(
                      id,
                      photoList.props.title,
                      photoList.state.selectedItems.map((i) => i.id)
                    )
                  );
                }}
              >
                <Icon name="trash" />
                {"  Remove Photos"}
              </Dropdown.Item>
            }
            content="Remove the selected photos from the current album"
          />
        </Dropdown.Menu>
      </Dropdown>
    </Button.Group>
  );
}
