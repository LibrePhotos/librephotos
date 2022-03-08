import React, { Component } from "react";
import "react-virtualized/styles.css"; // only needs to be imported once
import { connect } from "react-redux";
import { serverAddress } from "../../api_client/apiClient";
import Lightbox from "react-image-lightbox";
import ReactPlayer from "react-player";
import "react-image-lightbox/style.css"; // This only needs to be imported once in your app
import Toolbar from "./Toolbar";
import Sidebar from "./Sidebar";

var LIGHTBOX_SIDEBAR_WIDTH = 360;
if (window.innerWidth < 600) {
  LIGHTBOX_SIDEBAR_WIDTH = window.innerWidth;
}
export class LightBox extends Component {
  constructor(props) {
    super(props);

    this.closeSidepanel = this.closeSidepanel.bind(this);
  }

  state = {
    lightboxSidebarShow: false,
  };

  closeSidepanel() {
    this.setState({ lightboxSidebarShow: !this.state.lightboxSidebarShow });
    this.forceUpdate();
  }

  getCurrentPhotodetail() {
    return this.props.photoDetails[this.props.lightboxImageId];
  }

  isLoaded() {
    return !this.props.photoDetails[this.props.lightboxImageId];
  }

  getPreviousId() {
    const image = this.props.idx2hash.slice((this.props.lightboxImageIndex - 1) % this.props.idx2hash.length)[0];
    return image ? image.id : undefined;
  }

  getNextId() {
    const image = this.props.idx2hash.slice((this.props.lightboxImageIndex + 1) % this.props.idx2hash.length)[0];
    return image ? image.id : undefined;
  }

  getPictureUrl(id) {
    return serverAddress + "/media/thumbnails_big/" + id;
  }

  getVideoUrl(id) {
    return serverAddress + "/media/video/" + id;
  }

  isVideo() {
    if (this.getCurrentPhotodetail() === undefined || this.getCurrentPhotodetail().video === undefined) {
      return false;
    }
    return this.getCurrentPhotodetail().video;
  }

  render() {
    if (!this.isVideo()) {
      for (var i = 0; i < 10; i++) {
        setTimeout(() => {
          // Fix large wide images when side bar open; retry once per 250ms over 2.5 seconds
          if (document.getElementsByClassName("ril-image-current").length > 0) {
            this.setState({
              wideImg: document.getElementsByClassName("ril-image-current")[0].naturalWidth > window.innerWidth,
            });

            // 360px side bar /2 = 180px to the left = re-centers a wide image
            var translate = this.state.lightboxSidebarShow && this.state.wideImg ? `-180px` : "";

            if (document.getElementsByClassName("ril-image-current")[0].style.left !== translate) {
              document.getElementsByClassName("ril-image-current")[0].style.left = translate;

              // Fix react-image-lightbox
              // It did not re-calculate the image_prev and image_next when pressed left or right arrow key
              // It only updated those offsets on render / scroll / double click to zoom / etc.
              this.forceUpdate();
            }

            // Since we disabled animations, we can set image_prev and image_next visibility hidden
            // Fixes prev/next large wide 16:9 images were visible at same time as main small 9:16 image in view
            document.getElementsByClassName("ril-image-prev")[0].style.visibility = "hidden";
            document.getElementsByClassName("ril-image-next")[0].style.visibility = "hidden";
            document.getElementsByClassName("ril-image-current")[0].style.visibility = "visible";

            // Make toolbar background fully transparent
            if (document.getElementsByClassName("ril-toolbar").length > 0) {
              document.getElementsByClassName("ril-toolbar")[0].style.backgroundColor = "rgba(0, 0, 0, 0)";
            }
          }
        }, 250 * i);
      }
    }
    return (
      <div>
        <Lightbox
          animationDisabled={true}
          mainSrc={!this.isVideo() ? this.getPictureUrl(this.props.lightboxImageId) : null}
          nextSrc={this.getPictureUrl(this.getNextId())}
          prevSrc={this.getPictureUrl(this.getPreviousId())}
          mainCustomContent={
            this.isVideo() ? (
              <ReactPlayer
                width="100%"
                height="100%"
                controls={true}
                playing={true}
                url={this.getVideoUrl(this.props.lightboxImageId)}
                progressInterval={100}
              ></ReactPlayer>
            ) : null
          }
          imageLoadErrorMessage={""}
          toolbarButtons={[
            <Toolbar
              photosDetail={this.props.photoDetails[this.props.lightboxImageId]}
              lightboxSidebarShow={this.state.lightboxSidebarShow}
              closeSidepanel={this.closeSidepanel}
              isPublic={this.props.isPublic}
            ></Toolbar>,
          ]}
          onCloseRequest={this.props.onCloseRequest}
          onAfterOpen={() => {
            console.log("lightbox trying to fetch photo detail");
            this.props.onImageLoad();
          }}
          onMovePrevRequest={this.props.onMovePrevRequest}
          onMoveNextRequest={this.props.onMoveNextRequest}
          reactModalStyle={{
            content: {},
            overlay: {
              right: this.state.lightboxSidebarShow ? LIGHTBOX_SIDEBAR_WIDTH : 0,
              width: this.state.lightboxSidebarShow ? window.innerWidth - LIGHTBOX_SIDEBAR_WIDTH : window.innerWidth,
            },
          }}
        />
        {
          <Sidebar
            photoDetail={this.getCurrentPhotodetail()}
            lightboxSidebarShow={this.state.lightboxSidebarShow}
            closeSidepanel={this.closeSidepanel}
            isPublic={this.props.isPublic}
          ></Sidebar>
        }
        ;
      </div>
    );
  }
}

LightBox = connect((store) => {
  return {
    photoDetails: store.photos.photoDetails,
  };
})(LightBox);
