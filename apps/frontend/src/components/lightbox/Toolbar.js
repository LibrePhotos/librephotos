import React, { Component } from "react";
// only needs to be imported once
import { connect } from "react-redux";
import "react-virtualized/styles.css";
import { Button, Icon } from "semantic-ui-react";

import { setPhotosFavorite, setPhotosHidden, setPhotosPublic } from "../../actions/photosActions";
import { shareAddress } from "../../api_client/apiClient";
import { copyToClipboard } from "../../util/util";

export default class Toolbar extends Component {
  constructor(props) {
    super(props);
  }

  render() {
    return (
      <div>
        {!this.props.photosDetail && (
          <Button loading color="black" icon circular disabled={this.props.isPublic}>
            <Icon name="hide" color="grey" />
          </Button>
        )}
        {!this.props.photosDetail && (
          <Button loading color="black" icon circular disabled={this.props.isPublic}>
            <Icon name="star" color="grey" />
          </Button>
        )}
        {!this.props.photosDetail && (
          <Button loading color="black" icon circular disabled={this.props.isPublic}>
            <Icon name="globe" color="grey" />
          </Button>
        )}
        {this.props.photosDetail && (
          <Button
            disabled={this.props.isPublic}
            onClick={() => {
              const { image_hash } = this.props.photosDetail;
              const val = !this.props.photosDetail.hidden;
              this.props.dispatch(setPhotosHidden([image_hash], val));
            }}
            color="black"
            icon
            circular
          >
            <Icon name="hide" color={this.props.photosDetail.hidden ? "red" : "grey"} />
          </Button>
        )}
        {this.props.photosDetail && (
          <Button
            disabled={this.props.isPublic}
            onClick={() => {
              const { image_hash } = this.props.photosDetail;
              const val = !(this.props.photosDetail.rating >= this.props.favorite_min_rating);
              this.props.dispatch(setPhotosFavorite([image_hash], val));
            }}
            color="black"
            icon
            circular
          >
            <Icon
              name="star"
              color={this.props.photosDetail.rating >= this.props.favorite_min_rating ? "yellow" : "grey"}
            />
          </Button>
        )}
        {this.props.photosDetail && (
          <Button
            disabled={this.props.isPublic}
            onClick={() => {
              const { image_hash } = this.props.photosDetail;
              const val = !this.props.photosDetail.public;
              this.props.dispatch(setPhotosPublic([image_hash], val));
              copyToClipboard(
                // edited from serverAddress.replace('//','') + "/media/thumbnails_big/" + image_hash + ".jpg"
                // as above removed the domain and just left /media/thumbnails_big/" + image_hash + ".jpg"  *DW 12/9/20
                // Not location of shared photo link Reverted to orgiinal *DW 12/13/20
                `${shareAddress}/media/thumbnails_big/${image_hash}.jpg`
              );
            }}
            color="black"
            icon
            circular
          >
            <Icon name="globe" color={this.props.photosDetail.public ? "green" : "grey"} />
          </Button>
        )}
        <Button icon active={this.props.lightboxSidebarShow} circular onClick={() => this.props.closeSidepanel()}>
          <Icon name="info" />
        </Button>
      </div>
    );
  }
}

Toolbar = connect(store => ({
  favorite_min_rating: store.user.userSelfDetails.favorite_min_rating,
}))(Toolbar);
