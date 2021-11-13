import React, { Component } from "react";
import "react-virtualized/styles.css"; // only needs to be imported once
import {
  setPhotosFavorite,
  setPhotosHidden,
  setPhotosPublic,
  downloadPhotos,
} from "../../actions/photosActions";
import { copyToClipboard } from "../../util/util";
import { Dropdown, Popup, Button, Icon } from "semantic-ui-react";
import { serverAddress } from "../../api_client/apiClient";
import { connect } from "react-redux";
import { removeFromUserAlbum } from "../../actions/albumsActions";

export class SelectionActions extends Component {
  render() {
    return (
      <div>
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
                Photo Actions ({this.props.selectedItems.length} selected)
              </Dropdown.Header>

              <Dropdown.Divider />
              <Dropdown.Item
                disabled={this.props.selectedItems.length === 0}
                onClick={() => {
                  this.props.dispatch(
                    setPhotosFavorite(
                      this.props.selectedItems.map((i) => i.id),
                      true
                    )
                  );
                }}
              >
                <Icon name="star" color="yellow" />
                {"  Favorite"}
              </Dropdown.Item>
              <Dropdown.Item
                disabled={this.props.selectedItems.length === 0}
                onClick={() => {
                  this.props.dispatch(
                    setPhotosFavorite(
                      this.props.selectedItems.map((i) => i.id),
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
                disabled={this.props.selectedItems.length === 0}
                onClick={() => {
                  this.props.dispatch(
                    setPhotosHidden(
                      this.props.selectedItems.map((i) => i.id),
                      true
                    )
                  );
                }}
              >
                <Icon name="hide" color="red" />
                {"  Hide"}
              </Dropdown.Item>
              <Dropdown.Item
                disabled={this.props.selectedItems.length === 0}
                onClick={() => {
                  this.props.dispatch(
                    setPhotosHidden(
                      this.props.selectedItems.map((i) => i.id),
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
                disabled={this.props.selectedItems.length === 0}
                onClick={() => {
                  this.props.dispatch(
                    setPhotosPublic(
                      this.props.selectedItems.map((i) => i.id),
                      true
                    )
                  );
                  const linksToCopy = this.props.selectedItems
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
                disabled={this.props.selectedItems.length === 0}
                onClick={() => {
                  this.props.dispatch(
                    setPhotosPublic(
                      this.props.selectedItems.map((i) => i.id),
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
                disabled={this.props.selectedItems.length === 0}
                onClick={() => {
                  this.props.dispatch(
                    downloadPhotos(this.props.selectedItems.map((i) => i.id))
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
                    disabled={this.props.selectedItems.length === 0}
                    onClick={() => {
                      if (this.props.selectedItems.length > 0) {
                        this.props.onSharePhotos();
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
                      !this.props.route.location.pathname.startsWith(
                        "/useralbum/"
                      )
                    }
                    onClick={this.props.onShareAlbum}
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
                      !this.props.route.location.pathname.startsWith(
                        "/useralbum/" || this.props.selectedItems.length == 0
                      )
                    }
                    onClick={() => {
                      var id = this.props.albumID;
                      this.props.dispatch(
                        removeFromUserAlbum(
                          id,
                          this.props.title,
                          this.props.selectedItems.map((i) => i.id)
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

        <Button.Group
          style={{ paddingLeft: 2, paddingRight: 2 }}
          floated="right"
          compact
          color="teal"
        >
          <Dropdown
            disabled={this.props.selectedItems.length === 0}
            pointing="top right"
            icon="plus"
            floating
            button
            compact
            floated="right"
            className="icon"
          >
            <Dropdown.Menu>
              <Dropdown.Header>
                Album ({this.props.selectedItems.length} selected)
              </Dropdown.Header>
              <Dropdown.Divider />
              <Dropdown.Item
                onClick={() => {
                  if (this.props.selectedItems.length > 0) {
                    this.props.onAddToAlbum();
                  }
                }}
              >
                <Icon name="bookmark" color="red" />
                {" Album"}
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </Button.Group>
      </div>
    );
  }
}

SelectionActions = connect((store) => {
  return {
    route: store.router,
  };
})(SelectionActions);
