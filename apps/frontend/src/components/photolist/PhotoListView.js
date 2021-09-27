import React, { Component } from "react";
import Pig from "react-pig";
import "react-virtualized/styles.css"; // only needs to be imported once
import { connect } from "react-redux";
import { ModalAlbumEdit } from "../album/ModalAlbumEdit";
import { fetchPhotoDetail } from "../../actions/photosActions";
import { ModalPhotosShare } from "../sharing/ModalPhotosShare";
import { ModalAlbumShare } from "../sharing/ModalAlbumShare";
import { serverAddress } from "../../api_client/apiClient";
import { LightBox } from "../lightbox/LightBox";
import _ from "lodash";
import getSelectionBar from "../photolist/SelectionBar";
import FavoritedOverlay from "./FavoritedOverlay";
import { fetchSiteSettings } from "../../actions/utilActions";
import { fetchUserSelfDetails } from "../../actions/userActions";
import getDefaultHeader from "./Headers";
import { TOP_MENU_HEIGHT } from "../../ui-constants";

var SIDEBAR_WIDTH = 85;
var TIMELINE_SCROLL_WIDTH = 0;

export class PhotoListView extends Component {
  constructor(props) {
    super(props);
    this.handleResize = this.handleResize.bind(this);
    this.getPhotoDetails = this.getPhotoDetails.bind(this);
    this.listRef = React.createRef();
    this.getHeader = this.props.getHeader ? this.props.getHeader : getDefaultHeader;

    this.state = {
      selectedItems: [],
      lightboxImageIndex: 1,
      lightboxImageId: undefined,
      lightboxShow: false,
      lightboxSidebarShow: false,
      width: window.innerWidth,
      height: window.innerHeight,
      selectMode: false,
      modalAddToAlbumOpen: false,
      modalSharePhotosOpen: false,
      modalAlbumShareOpen: false,
    };
  }

  componentDidMount() {
    this.handleResize();
    window.addEventListener("resize", this.handleResize);
    this.props.dispatch(fetchSiteSettings());
    this.props.dispatch(fetchUserSelfDetails(this.props.auth.access.user_id));
  }
  componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize);
  }

  handleSelection = (item) => {
    var newSelectedItems = this.state.selectedItems;
    if (newSelectedItems.find((selectedItem) => selectedItem.id === item.id)) {
      newSelectedItems = newSelectedItems.filter(
        (value) => value.id !== item.id
      );
    } else {
      newSelectedItems = newSelectedItems.concat(item);
    }
    this.setState({ selectedItems: newSelectedItems });
    this.setState({ selectMode: !newSelectedItems.length === 0 });
  };

  handleSelections = (items) => {
    var newSelectedItems = this.state.selectedItems;
    items.forEach((item) => {
      console.log(item);
      if (
        newSelectedItems.find((selectedItem) => selectedItem.id === item.id)
      ) {
        newSelectedItems = newSelectedItems.filter(
          (value) => value.id !== item.id
        );
      } else {
        newSelectedItems = newSelectedItems.concat(item);
      }
    });
    this.setState({ selectedItems: newSelectedItems });
    this.setState({ selectMode: !newSelectedItems.length === 0 });
  };

  handleClick = (event, item) => {
    //if an image is selectabel, then handle shift click
    if (event.shiftKey) {
      var lastSelectedElement = this.state.selectedItems.slice(-1)[0];
      if (lastSelectedElement === undefined) {
        this.handleSelection(item);
        return;
      }
      var indexOfCurrentlySelectedItem = this.props.idx2hash.findIndex(
        (image) => image.id === item.id
      );
      var indexOfLastSelectedItem = this.props.idx2hash.findIndex(
        (image) => image.id === lastSelectedElement.id
      );
      console.log(indexOfCurrentlySelectedItem);
      console.log(indexOfLastSelectedItem);
      if (indexOfCurrentlySelectedItem > indexOfLastSelectedItem) {
        this.handleSelections(
          this.props.idx2hash.slice(
            indexOfLastSelectedItem + 1,
            indexOfCurrentlySelectedItem + 1
          )
        );
        return;
      } else {
        this.handleSelections(
          this.props.idx2hash.slice(
            indexOfCurrentlySelectedItem,
            indexOfLastSelectedItem
          )
        );
        return;
      }
    }
    // if an image is already selected, then we are in selection mode
    if (this.state.selectedItems.length > 0) {
      this.handleSelection(item);
      return;
    }

    const lightboxImageIndex = this.props.idx2hash.findIndex(
      (image) => image.id === item.id
    );
    this.setState({
      lightboxImageIndex: lightboxImageIndex,
      lightboxImageId: item.id,
      lightboxShow: lightboxImageIndex >= 0,
    });
  };

  handleResize() {
    var columnWidth = window.innerWidth - 5 - 5 - 10;
    if (this.props.showSidebar) {
      columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 10;
    }

    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
    });
    if (this.listRef.current) {
      this.listRef.current.recomputeGridSize();
    }
  }

  getPhotoDetails(image) {
    this.props.dispatch(fetchPhotoDetail(image));
  }

  closeLightboxIfImageIndexIsOutOfSync() {
    console.log(this.state);
    console.log(this.props);
    if (
      this.state.lightboxShow &&
      (this.props.idx2hash.length <= this.state.lightboxImageIndex ||
        this.state.lightboxImageId !==
          this.props.idx2hash[this.state.lightboxImageIndex].id)
    ) {
      this.setState({ lightboxShow: false });
    }
  }

  render() {
    this.closeLightboxIfImageIndexIsOutOfSync();

    console.log(this.props);
    var isUserAlbum = false;
    if (this.props.route.location.pathname.startsWith("/useralbum/")) {
      isUserAlbum = true;
    }

    return (
      <div>
        <div
          style={{
            marginTop: 5,
            width: "100%",
            zIndex: 100,
            backgroundColor: "white",
          }}
        >
          {this.getHeader(this)}

          {!this.props.isPublic && getSelectionBar(this)}
        </div>
        {this.props.photosGroupedByDate && this.props.photosGroupedByDate.length > 0 ? (
          <div style={{ top: TOP_MENU_HEIGHT + 70 }}>
            <Pig
              imageData={
                !Array.isArray(this.props.photosGroupedByDate)
                  ? [this.props.photosGroupedByDate]
                  : this.props.photosGroupedByDate
              }
              selectable={true}
              selectedItems={this.state.selectedItems}
              handleSelection={this.handleSelection}
              handleClick={this.handleClick}
              scaleOfImages={this.props.userSelfDetails.image_scale}
              groupByDate={this.props.isDateView}
              getUrl={(url, pxHeight) => {
                if (pxHeight < 250) {
                  return (
                    serverAddress +
                    "/media/square_thumbnails_small/" +
                    url.split(";")[0]
                  );
                }
                return (
                  serverAddress +
                  "/media/square_thumbnails/" +
                  url.split(";")[0]
                );
              }}
              overlay={FavoritedOverlay}
            ></Pig>
          </div>
        ) : (
          <div></div>
        )}

        <div
          style={{
            backgroundColor: "white",
            position: "fixed",
            right: 0,
            top: TOP_MENU_HEIGHT,
            height: this.state.height - TOP_MENU_HEIGHT,
            width: TIMELINE_SCROLL_WIDTH,
          }}
        />

        {this.state.lightboxShow && (
          <LightBox
            isPublic={this.props.isPublic}
            showHidden={this.props.showHidden}
            idx2hash={this.props.idx2hash}
            lightboxImageIndex={this.state.lightboxImageIndex}
            lightboxImageId={this.state.lightboxImageId}
            onCloseRequest={() => this.setState({ lightboxShow: false })}
            onImageLoad={() => {
              console.log("Somebody calles me?");
              this.getPhotoDetails(
                this.props.idx2hash[this.state.lightboxImageIndex].id
              );
            }}
            onMovePrevRequest={() => {
              var prevIndex =
                (this.state.lightboxImageIndex +
                  this.props.idx2hash.length -
                  1) %
                this.props.idx2hash.length;
              this.setState({
                lightboxImageIndex: prevIndex,
                lightboxImageId: this.props.idx2hash[prevIndex].id,
              });
              this.getPhotoDetails(this.props.idx2hash[prevIndex].id);
            }}
            onMoveNextRequest={() => {
              var nextIndex =
                (this.state.lightboxImageIndex +
                  this.props.idx2hash.length +
                  1) %
                this.props.idx2hash.length;
              this.setState({
                lightboxImageIndex: nextIndex,
                lightboxImageId: this.props.idx2hash[nextIndex].id,
              });
              this.getPhotoDetails(this.props.idx2hash[nextIndex].id);
            }}
          />
        )}

        {!this.props.isPublic && (
          <ModalAlbumEdit
            isOpen={this.state.modalAddToAlbumOpen}
            onRequestClose={() => {
              this.setState({
                modalAddToAlbumOpen: false,
              });
            }}
            selectedImageHashes={this.state.selectedItems.map((i) => i.id)}
          />
        )}
        {!this.props.isPublic && (
          <ModalPhotosShare
            isOpen={this.state.modalSharePhotosOpen}
            onRequestClose={() => {
              this.setState({
                modalSharePhotosOpen: false,
              });
            }}
            selectedImageHashes={this.state.selectedItems.map((i) => i.id)}
          />
        )}
        {!this.props.isPublic && isUserAlbum && (
          <ModalAlbumShare
            isOpen={this.state.modalAlbumShareOpen}
            onRequestClose={() => {
              this.setState({
                modalAlbumShareOpen: false,
              });
            }}
            match={this.props.match}
            selectedImageHashes={this.state.selectedItems.map((i) => i.id)}
          />
        )}
      </div>
    );
  }
}

PhotoListView = connect((store) => {
  return {
    auth: store.auth,
    showSidebar: store.ui.showSidebar,
    route: store.routerReducer,
    userSelfDetails: store.user.userSelfDetails,
  };
})(PhotoListView);
