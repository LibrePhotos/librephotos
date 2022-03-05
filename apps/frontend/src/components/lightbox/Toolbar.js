import React, { Component } from "react";
import "react-virtualized/styles.css"; // only needs to be imported once
import { copyToClipboard } from "../../util/util";
import { connect } from "react-redux";
import { setPhotosFavorite, setPhotosHidden, setPhotosPublic } from "../../actions/photosActions";
import { Button, Icon } from "semantic-ui-react";
import { shareAddress } from "../../api_client/apiClient";

export default class Toolbar extends Component {
  constructor(props) {
    super(props);
  }

  render() {
    return (
      <div>
        {!this.props.photosDetail && (
          <Button loading color="black" icon circular disabled={this.props.isPublic}>
            <Icon name="hide" color={"grey"} />
          </Button>
        )}
        {!this.props.photosDetail && (
          <Button loading color="black" icon circular disabled={this.props.isPublic}>
            <Icon name="star" color={"grey"} />
          </Button>
        )}
        {!this.props.photosDetail && (
          <Button loading color="black" icon circular disabled={this.props.isPublic}>
            <Icon name="globe" color={"grey"} />
          </Button>
        )}
        {this.props.photosDetail && (
          <Button
            disabled={this.props.isPublic}
            onClick={() => {
              const image_hash = this.props.photosDetail.image_hash;
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
              const image_hash = this.props.photosDetail.image_hash;
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
              const image_hash = this.props.photosDetail.image_hash;
              const val = !this.props.photosDetail.public;
              this.props.dispatch(setPhotosPublic([image_hash], val));
              copyToClipboard(
                //edited from serverAddress.replace('//','') + "/media/thumbnails_big/" + image_hash + ".jpg"
                // as above removed the domain and just left /media/thumbnails_big/" + image_hash + ".jpg"  *DW 12/9/20
                // Not location of shared photo link Reverted to orgiinal *DW 12/13/20
                shareAddress + "/media/thumbnails_big/" + image_hash + ".jpg"
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

Toolbar = connect((store) => {
  return {
    favorite_min_rating: store.user.userSelfDetails.favorite_min_rating,
  };
})(Toolbar);
