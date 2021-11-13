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
import { SelectionBar } from "../photolist/SelectionBar";
import FavoritedOverlay from "./FavoritedOverlay";
import { DefaultHeader } from "./DefaultHeader";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { SelectionActions } from "./SelectionActions";

var TIMELINE_SCROLL_WIDTH = 0;

export class PhotoListView extends Component {
  constructor(props) {
    super(props);
    this.handleResize = this.handleResize.bind(this);
    this.getPhotoDetails = this.getPhotoDetails.bind(this);
    this.listRef = React.createRef();

    this.state = {
      lightboxImageIndex: 1,
      lightboxImageId: undefined,
      lightboxShow: false,
      lightboxSidebarShow: false,
      width: window.innerWidth,
      height: window.innerHeight,
      modalAddToAlbumOpen: false,
      modalSharePhotosOpen: false,
      modalAlbumShareOpen: false,
      selectionState: {
        selectedItems: [],
        selectMode: false,
      },
    };

    this.updateSelectionState = this.updateSelectionState.bind(this);
  }

  componentDidMount() {
    this.handleResize();
    window.addEventListener("resize", this.handleResize);
  }
  componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize);
  }

  updateSelectionState(newState) {
    this.setState({
      selectionState: { ...this.state.selectionState, ...newState },
    });
  }

  handleSelection = (item) => {
    var newSelectedItems = this.state.selectionState.selectedItems;
    if (newSelectedItems.find((selectedItem) => selectedItem.id === item.id)) {
      newSelectedItems = newSelectedItems.filter(
        (value) => value.id !== item.id
      );
    } else {
      newSelectedItems = newSelectedItems.concat(item);
    }

    this.updateSelectionState({
      selectedItems: newSelectedItems,
      selectMode: newSelectedItems.length > 0,
    });
  };

  handleSelections = (items) => {
    var newSelectedItems = this.state.selectionState.selectedItems;
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
    this.updateSelectionState({
      selectedItems: newSelectedItems,
      selectMode: newSelectedItems.length > 0,
    });
  };

  handleClick = (event, item) => {
    //if an image is selectable, then handle shift click
    if (this.props.selectable && event.shiftKey) {
      var lastSelectedElement =
        this.state.selectionState.selectedItems.slice(-1)[0];
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
    if (this.state.selectionState.selectMode) {
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
    //
  }

  getPhotoDetails(image) {
    this.props.dispatch(fetchPhotoDetail(image));
  }

  closeLightboxIfImageIndexIsOutOfSync() {
    if (
      this.state.lightboxShow &&
      (this.props.idx2hash.length <= this.state.lightboxImageIndex ||
        this.state.lightboxImageId !==
          this.props.idx2hash[this.state.lightboxImageIndex].id)
    ) {
      this.setState({ lightboxShow: false });
    }
  }

  getNumPhotosetItems() {
    return this.props.photoset ? this.props.photoset.length : 0;
  }

  getNumPhotos() {
    return this.props.idx2hash ? this.props.idx2hash.length : 0;
  }

  getPigImageData() {
    return Array.isArray(this.props.photoset)
      ? this.props.photoset
      : [this.props.photoset];
  }

  render() {
    this.closeLightboxIfImageIndexIsOutOfSync();

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
          {this.props.header ? (
            this.props.header
          ) : (
            <DefaultHeader
              photoList={this}
              loading={this.props.loading}
              numPhotosetItems={this.getNumPhotosetItems()}
              numPhotos={this.getNumPhotos()}
              noResultsMessage={this.props.noResultsMessage}
              titleIconName={this.props.titleIconName}
              title={this.props.title}
              dayHeaderPrefix={this.props.dayHeaderPrefix}
              date={this.props.date}
              additionalSubHeader={this.props.additionalSubHeader}
            />
          )}
          {!this.props.loading && !this.props.isPublic && (
            <div
              style={{
                marginLeft: -5,
                paddingLeft: 5,
                paddingRight: 5,
                height: 40,
                paddingTop: 4,
                backgroundColor: "#f6f6f6",
              }}
            >
              <SelectionBar
                selectMode={this.state.selectionState.selectMode}
                selectedItems={this.state.selectionState.selectedItems}
                idx2hash={this.props.idx2hash}
                updateSelectionState={this.updateSelectionState}
              />
              <SelectionActions
                selectedItems={this.state.selectionState.selectedItems}
                albumID={
                  this.props.match ? this.props.match.params.albumID : undefined
                }
                title={this.props.title}
                onSharePhotos={() =>
                  this.setState({ modalSharePhotosOpen: true })
                }
                onShareAlbum={() =>
                  this.setState({ modalAlbumShareOpen: true })
                }
                onAddToAlbum={() =>
                  this.setState({ modalAddToAlbumOpen: true })
                }
              />
            </div>
          )}
        </div>
        {!this.props.loading &&
        this.props.photoset &&
        this.props.photoset.length > 0 ? (
          <div style={{ top: TOP_MENU_HEIGHT + 70 }}>
            <Pig
              imageData={this.getPigImageData()}
              selectable={
                this.props.selectable === undefined || this.props.selectable
              }
              selectedItems={this.state.selectionState.selectedItems}
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
              numberOfItems={
                this.props.numberOfItems
                  ? this.props.numberOfItems
                  : this.props.idx2hash.length
              }
              updateItems={
                this.props.updateItems ? this.props.updateItems : () => {}
              }
              updateGroups={
                this.props.updateGroups ? this.props.updateGroups : () => {}
              }
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
            selectedImageHashes={this.state.selectionState.selectedItems.map(
              (i) => i.id
            )}
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
            selectedImageHashes={this.state.selectionState.selectedItems.map(
              (i) => i.id
            )}
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
            selectedImageHashes={this.state.selectionState.selectedItems.map(
              (i) => i.id
            )}
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
    route: store.router,
    userSelfDetails: store.user.userSelfDetails,
  };
})(PhotoListView);
