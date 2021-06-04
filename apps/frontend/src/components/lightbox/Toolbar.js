import React, { Component } from "react";
import "react-virtualized/styles.css"; // only needs to be imported once
import { copyToClipboard } from "../../util/util";
import {
  setPhotosFavorite,
  setPhotosHidden,
  setPhotosPublic,
} from "../../actions/photosActions";
import { Button, Icon } from "semantic-ui-react";
import { shareAddress } from "../../api_client/apiClient";

export default function getToolbar(box) {
  return [
    <div>
      {!box.props.photoDetails[
        box.props.idx2hash[box.props.lightboxImageIndex]
      ] && (
        <Button
          loading
          color="black"
          icon
          circular
          disabled={box.props.isPublic}
        >
          <Icon name="hide" color={"grey"} />
        </Button>
      )}
      {!box.props.photoDetails[
        box.props.idx2hash[box.props.lightboxImageIndex]
      ] && (
        <Button
          loading
          color="black"
          icon
          circular
          disabled={box.props.isPublic}
        >
          <Icon name="star" color={"grey"} />
        </Button>
      )}
      {!box.props.photoDetails[
        box.props.idx2hash[box.props.lightboxImageIndex]
      ] && (
        <Button
          loading
          color="black"
          icon
          circular
          disabled={box.props.isPublic}
        >
          <Icon name="globe" color={"grey"} />
        </Button>
      )}
      {box.props.photoDetails[
        box.props.idx2hash[box.props.lightboxImageIndex]
      ] && (
        <Button
          disabled={box.props.isPublic}
          onClick={() => {
            const image_hash = box.props.idx2hash[
              box.props.lightboxImageIndex
            ];
            const val = !box.props.photoDetails[image_hash].hidden;
            box.props.dispatch(setPhotosHidden([image_hash], val));
          }}
          color="black"
          icon
          circular
        >
          <Icon
            name="hide"
            color={
              box.props.photoDetails[
                box.props.idx2hash[box.props.lightboxImageIndex]
              ].hidden
                ? "red"
                : "grey"
            }
          />
        </Button>
      )}
      {box.props.photoDetails[
        box.props.idx2hash[box.props.lightboxImageIndex]
      ] && (
        <Button
          disabled={box.props.isPublic}
          onClick={() => {
            const image_hash = box.props.idx2hash[
              box.props.lightboxImageIndex
            ];
            const val = !box.props.photoDetails[image_hash].favorited;
            box.props.dispatch(setPhotosFavorite([image_hash], val));
          }}
          color="black"
          icon
          circular
        >
          <Icon
            name="star"
            color={
              box.props.photoDetails[
                box.props.idx2hash[box.props.lightboxImageIndex]
              ].favorited
                ? "yellow"
                : "grey"
            }
          />
        </Button>
      )}
      {box.props.photoDetails[
        box.props.idx2hash[box.props.lightboxImageIndex]
      ] && (
        <Button
          disabled={box.props.isPublic}
          onClick={() => {
            const image_hash = box.props.idx2hash[
              box.props.lightboxImageIndex
            ];
            const val = !box.props.photoDetails[image_hash].public;
            box.props.dispatch(setPhotosPublic([image_hash], val));
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
          <Icon
            name="globe"
            color={
              box.props.photoDetails[
                box.props.idx2hash[box.props.lightboxImageIndex]
              ].public
                ? "green"
                : "grey"
            }
          />
        </Button>
      )}
      <Button
        icon
        active={box.state.lightboxSidebarShow}
        circular
        onClick={() => {
          box.setState({
            lightboxSidebarShow: !box.state.lightboxSidebarShow,
          });
        }}
      >
        <Icon name="info" />
      </Button>
    </div>,
  ];
}
