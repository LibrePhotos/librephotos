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
import { withTranslation, Trans } from "react-i18next";
import { compose } from "redux";
export class SelectionActions extends Component {
  render() {
    return (
      <div >
        <Button.Group
          style={{ paddingLeft: 2, paddingRight: 2}}
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
                {this.props.t("selectionactions.photoactions")} (
                {this.props.selectedItems.length}{" "}
                {this.props.t("selectionactions.selected")} )
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
                {"  " + this.props.t("selectionactions.favorite")}
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
                {"  " + this.props.t("selectionactions.unfavorite")}
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
                {"  " + this.props.t("selectionactions.hide")}
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
                {"  " + this.props.t("selectionactions.unhide")}
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
                {"  " + this.props.t("selectionactions.makepublic")}
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
                {"  " + this.props.t("selectionactions.makeprivate")}
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
                {"  " + this.props.t("selectionactions.download")}
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
                    {"  " + this.props.t("selectionactions.sharing")}
                  </Dropdown.Item>
                }
                content={this.props.t("selectionactions.sharingdescription")}
              />
              <Dropdown.Divider />
              <Dropdown.Header>
                <Icon name="images" />
                {this.props.t("selectionactions.albumactions")}
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
                    {"  " + this.props.t("selectionactions.sharing")}
                  </Dropdown.Item>
                }
                content={this.props.t(
                  "selectionactions.albumsharingdescription"
                )}
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
                    {"  " + this.props.t("selectionactions.removephotos")}
                  </Dropdown.Item>
                }
                content={this.props.t(
                  "selectionactions.removephotosdescription"
                )}
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
                {this.props.t("selectionactions.album")} (
                {this.props.selectedItems.length}{" "}
                {this.props.t("selectionactions.selected")} )
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

SelectionActions = compose(
  connect((store) => {
    return {
      route: store.router,
    };
  }),
  withTranslation()
)(SelectionActions);
