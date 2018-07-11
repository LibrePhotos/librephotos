import React, { Component } from "react";
import ReactDOM from "react-dom";
import { List, WindowScroller, AutoSizer } from "react-virtualized";
import "react-virtualized/styles.css"; // only needs to be imported once
import { connect } from "react-redux";
import {
  fetchDateAlbumsPhotoHashList,
  fetchAlbumsDateGalleries
} from "../actions/albumsActions";
import { copyToClipboard } from "../util/util";
import {
  fetchPhotoDetail,
  setPhotosFavorite,
  setPhotosHidden,
  setPhotosPublic,
  generatePhotoIm2txtCaption
} from "../actions/photosActions";
import {
  Card,
  Image,
  Header,
  Divider,
  Item,
  Loader,
  Dimmer,
  Form,
  Modal,
  Sticky,
  Portal,
  Grid,
  List as ListSUI,
  Container,
  Label,
  Popup,
  Segment,
  Button,
  Input,
  Icon,
  Table,
  Transition,
  Breadcrumb
} from "semantic-ui-react";
import { Server, serverAddress } from "../api_client/apiClient";
import LazyLoad from "react-lazyload";
import Lightbox from "react-image-lightbox";
import { LocationMap } from "../components/maps";
import { push } from "react-router-redux";
import { searchPhotos } from "../actions/searchActions";
import styles from "../App.css";
import Draggable from "react-draggable";
import debounce from "lodash/debounce";
import * as moment from "moment";

var topMenuHeight = 55; // don't change this
var leftMenuWidth = 85; // don't change this
var SIDEBAR_WIDTH = 85;
var timelineScrollWidth = 0;
var DAY_HEADER_HEIGHT = 35;

if (window.innerWidth < 600) {
  var LIGHTBOX_SIDEBAR_WIDTH = window.innerWidth;
} else {
  var LIGHTBOX_SIDEBAR_WIDTH = 360;
}

const colors = [
  "red",
  "orange",
  "yellow",
  "olive",
  "green",
  "teal",
  "blue",
  "violet",
  "purple",
  "pink",
  "brown",
  "grey",
  "black"
];

export class LightBox extends Component {
  state = {
    lightboxSidebarShow: false
  };

  render() {
    const authGetParams = !this.props.isPublic
      ? "?jwt=" + this.props.auth.access.token
      : "";
    if (
      !this.props.photoDetails[
        this.props.idx2hash.slice(this.props.lightboxImageIndex)[0]
      ]
    ) {
      console.log("light box has not gotten main photo detail");
      var mainSrc = "/transparentbackground.png";
      var mainSrcThumbnail = "/transparentbackground.png";
    } else {
      console.log("light box has got main photo detail");
      var mainSrc =
        serverAddress +
        "/media/photos/" +
        this.props.idx2hash.slice(this.props.lightboxImageIndex)[0] +
        ".jpg";
      var mainSrcThumbnail =
        serverAddress +
        "/media/thumbnails_small/" +
        this.props.idx2hash.slice(this.props.lightboxImageIndex)[0] +
        ".jpg";
      if (
        this.props.photoDetails[
          this.props.idx2hash.slice(this.props.lightboxImageIndex)[0]
        ].hidden &&
        !this.props.showHidden
      ) {
        var mainSrc = "/hidden.png";
        var mainSrcThumbnail = "/hidden.png";
      }
    }

    return (
      <div>
        <Lightbox
          animationDisabled={true}
          mainSrc={mainSrc}
          nextSrc={
            serverAddress +
            "/media/photos/" +
            this.props.idx2hash.slice(
              (this.props.lightboxImageIndex + 1) % this.props.idx2hash.length
            )[0] +
            ".jpg"
          }
          prevSrc={
            serverAddress +
            "/media/photos/" +
            this.props.idx2hash.slice(
              (this.props.lightboxImageIndex - 1) % this.props.idx2hash.length
            )[0] +
            ".jpg"
          }
          mainSrcThumbnail={mainSrcThumbnail}
          nextSrcThumbnail={
            serverAddress +
            "/media/thumbnails_small/" +
            this.props.idx2hash.slice(
              (this.props.lightboxImageIndex + 1) % this.props.idx2hash.length
            )[0] +
            ".jpg"
          }
          prevSrcThumbnail={
            serverAddress +
            "/media/thumbnails_small/" +
            this.props.idx2hash.slice(
              (this.props.lightboxImageIndex - 1) % this.props.idx2hash.length
            )[0] +
            ".jpg"
          }
          toolbarButtons={[
            <div>
              {!this.props.photoDetails[
                this.props.idx2hash[this.props.lightboxImageIndex]
              ] && (
                <Button
                  loading
                  color="black"
                  icon
                  circular
                  disabled={this.props.isPublic}
                >
                  <Icon name="hide" color={"grey"} />
                </Button>
              )}
              {!this.props.photoDetails[
                this.props.idx2hash[this.props.lightboxImageIndex]
              ] && (
                <Button
                  loading
                  color="black"
                  icon
                  circular
                  disabled={this.props.isPublic}
                >
                  <Icon name="star" color={"grey"} />
                </Button>
              )}
              {!this.props.photoDetails[
                this.props.idx2hash[this.props.lightboxImageIndex]
              ] && (
                <Button
                  loading
                  color="black"
                  icon
                  circular
                  disabled={this.props.isPublic}
                >
                  <Icon name="globe" color={"grey"} />
                </Button>
              )}
              {this.props.photoDetails[
                this.props.idx2hash[this.props.lightboxImageIndex]
              ] && (
                <Button
                  disabled={this.props.isPublic}
                  onClick={() => {
                    const image_hash = this.props.idx2hash[
                      this.props.lightboxImageIndex
                    ];
                    const val = !this.props.photoDetails[image_hash].hidden;
                    this.props.dispatch(setPhotosHidden([image_hash], val));
                  }}
                  color="black"
                  icon
                  circular
                >
                  <Icon
                    name="hide"
                    color={
                      this.props.photoDetails[
                        this.props.idx2hash[this.props.lightboxImageIndex]
                      ].hidden
                        ? "red"
                        : "grey"
                    }
                  />
                </Button>
              )}
              {this.props.photoDetails[
                this.props.idx2hash[this.props.lightboxImageIndex]
              ] && (
                <Button
                  disabled={this.props.isPublic}
                  onClick={() => {
                    const image_hash = this.props.idx2hash[
                      this.props.lightboxImageIndex
                    ];
                    const val = !this.props.photoDetails[image_hash].favorited;
                    this.props.dispatch(setPhotosFavorite([image_hash], val));
                  }}
                  color="black"
                  icon
                  circular
                >
                  <Icon
                    name="star"
                    color={
                      this.props.photoDetails[
                        this.props.idx2hash[this.props.lightboxImageIndex]
                      ].favorited
                        ? "yellow"
                        : "grey"
                    }
                  />
                </Button>
              )}
              {this.props.photoDetails[
                this.props.idx2hash[this.props.lightboxImageIndex]
              ] && (
                <Button
                  disabled={this.props.isPublic}
                  onClick={() => {
                    const image_hash = this.props.idx2hash[
                      this.props.lightboxImageIndex
                    ];
                    const val = !this.props.photoDetails[image_hash].public;
                    this.props.dispatch(setPhotosPublic([image_hash], val));
                    copyToClipboard(
                      serverAddress + "/media/photos/" + image_hash + ".jpg"
                    );
                  }}
                  color="black"
                  icon
                  circular
                >
                  <Icon
                    name="globe"
                    color={
                      this.props.photoDetails[
                        this.props.idx2hash[this.props.lightboxImageIndex]
                      ].public
                        ? "green"
                        : "grey"
                    }
                  />
                </Button>
              )}
              <Button
                icon
                active={this.state.lightboxSidebarShow}
                circular
                onClick={() => {
                  this.setState({
                    lightboxSidebarShow: !this.state.lightboxSidebarShow
                  });
                }}
              >
                <Icon name="info" />
              </Button>
            </div>
          ]}
          onCloseRequest={this.props.onCloseRequest}
          onAfterOpen={() => {
            console.log("lightbox trying to fetch photo detail");
            this.props.onImageLoad();
          }}
          onMovePrevRequest={this.props.onMovePrevRequest}
          onMoveNextRequest={this.props.onMoveNextRequest}
          sidebarWidth={
            this.state.lightboxSidebarShow ? LIGHTBOX_SIDEBAR_WIDTH : 0
          }
          reactModalStyle={{
            content: {
              // transform: this.state.lightboxSidebarShow ? `scale(0.5,1)` : ''
              // right: this.state.lightboxSidebarShow ? LIGHTBOX_SIDEBAR_WIDTH : 0,
              // width: this.state.lightboxSidebarShow ? window.innerWidth - LIGHTBOX_SIDEBAR_WIDTH : window.innerWidth,
            },
            overlay: {
              right: this.state.lightboxSidebarShow
                ? LIGHTBOX_SIDEBAR_WIDTH
                : 0,
              width: this.state.lightboxSidebarShow
                ? window.innerWidth - LIGHTBOX_SIDEBAR_WIDTH
                : window.innerWidth
            }
          }}
        />
        <Transition
          visible={this.state.lightboxSidebarShow}
          animation="fade left"
          duration={500}
        >
          <div
            style={{
              right: 0,
              top: 0,
              float: "right",
              backgroundColor: "white",
              width: LIGHTBOX_SIDEBAR_WIDTH,
              height: window.innerHeight,
              whiteSpace: "normal",
              position: "fixed",
              overflowY: "scroll",
              overflowX: "hidden",
              zIndex: 1000
            }}
          >
            {this.props.photoDetails.hasOwnProperty(
              this.props.idx2hash[this.props.lightboxImageIndex]
            ) && (
              <div style={{ width: LIGHTBOX_SIDEBAR_WIDTH }}>
                <div
                  style={{
                    paddingLeft: 30,
                    paddingRight: 30,
                    fontSize: "14px",
                    lineHeight: "normal",
                    whiteSpace: "normal",
                    wordWrap: "break-all"
                  }}
                >
                  <Button
                    floated="right"
                    circular
                    icon="close"
                    onClick={() => {
                      this.setState({ lightboxSidebarShow: false });
                      this.forceUpdate();
                    }}
                  />
                  <Header as="h3">Details</Header>

                  <Item.Group relaxed>
                    <Item>
                      <Item.Content verticalAlign="middle">
                        <Item.Header>
                          <Icon name="calendar" /> Time Taken
                        </Item.Header>
                        <Item.Description>
                          {moment(
                            this.props.photoDetails[
                              this.props.idx2hash[this.props.lightboxImageIndex]
                            ].exif_timestamp
                          ).format("dddd, MMMM Do YYYY, h:mm a")}
                        </Item.Description>
                      </Item.Content>
                    </Item>

                    <Item>
                      <Item.Content verticalAlign="middle">
                        <Item.Header>
                          <Icon name="file" /> File Path
                        </Item.Header>
                        <Item.Description>
                          <Breadcrumb
                            divider="/"
                            sections={this.props.photoDetails[
                              this.props.idx2hash[this.props.lightboxImageIndex]
                            ].image_path
                              .split("/")
                              .map(el => {
                                return { key: el, content: el };
                              })}
                          />
                        </Item.Description>
                      </Item.Content>
                    </Item>

                    <Item>
                      <Item.Content verticalAlign="middle">
                        <Item.Header>
                          <Icon name="users" /> People
                        </Item.Header>
                        <Item.Description>
                          <Label.Group>
                            {this.props.photoDetails[
                              this.props.idx2hash[this.props.lightboxImageIndex]
                            ].people.map((nc, idx) => (
                              <Label
                                color={
                                  colors[
                                    idx %
                                      this.props.photoDetails[
                                        this.props.idx2hash[
                                          this.props.lightboxImageIndex
                                        ]
                                      ].people.length
                                  ]
                                }
                                onClick={() => {
                                  this.props.dispatch(searchPhotos(nc));
                                  this.props.dispatch(push("/search"));
                                }}
                              >
                                <Icon name="user" />
                                {nc}
                              </Label>
                            ))}
                          </Label.Group>
                        </Item.Description>
                      </Item.Content>
                    </Item>

                    <Item>
                      <Item.Content verticalAlign="middle">
                        <Item.Header>
                          <Icon name="point" /> Location
                        </Item.Header>
                        <Item.Description>
                          {
                            this.props.photoDetails[
                              this.props.idx2hash[this.props.lightboxImageIndex]
                            ].search_location
                          }
                        </Item.Description>
                      </Item.Content>
                    </Item>

                    <div
                      style={{
                        width: LIGHTBOX_SIDEBAR_WIDTH - 70,
                        whiteSpace: "normal",
                        lineHeight: "normal"
                      }}
                    >
                      {this.props.photoDetails[
                        this.props.idx2hash[this.props.lightboxImageIndex]
                      ].exif_gps_lat && (
                        <LocationMap
                          zoom={8}
                          photos={[
                            this.props.photoDetails[
                              this.props.idx2hash[this.props.lightboxImageIndex]
                            ]
                          ]}
                        />
                      )}
                    </div>

                    <Item>
                      <Item.Content verticalAlign="middle">
                        <Item.Header>
                          <Icon name="write" /> Caption
                        </Item.Header>
                        <Item.Description>
                          {false &&
                            this.props.photoDetails[
                              this.props.idx2hash[this.props.lightboxImageIndex]
                            ].captions_json.im2txt}
                          <Form>
                            <Form.TextArea
                              disabled={this.props.isPublic}
                              fluid
                              placeholder={
                                this.props.photoDetails[
                                  this.props.idx2hash[
                                    this.props.lightboxImageIndex
                                  ]
                                ].captions_json.im2txt
                              }
                            >
                              {
                                this.props.photoDetails[
                                  this.props.idx2hash[
                                    this.props.lightboxImageIndex
                                  ]
                                ].captions_json.im2txt
                              }
                            </Form.TextArea>
                            <Button
                              disabled={this.props.isPublic}
                              floated="left"
                              size="small"
                              color="green"
                            >
                              Submit
                            </Button>
                            <Button
                              loading={this.props.generatingCaptionIm2txt}
                              onClick={()=>{this.props.dispatch(generatePhotoIm2txtCaption(this.props.idx2hash[this.props.lightboxImageIndex]))}}
                              disabled={this.props.isPublic | this.props.generatingCaptionIm2txt}
                              floated="left"
                              size="small"
                              color="blue"
                            >
                              Generate
                            </Button>
                            <Button
                              disabled={this.props.isPublic}
                              floated="right"
                              size="small"
                              basic
                            >
                              Cancel
                            </Button>
                          </Form>
                        </Item.Description>
                      </Item.Content>
                    </Item>

                    <Item>
                      <Item.Content verticalAlign="middle">
                        <Item.Header>
                          <Icon name="tags" /> Scene
                        </Item.Header>
                        <Item.Description>
                          <p>
                            <b>Attributes</b>
                          </p>
                          <Label.Group>
                            {this.props.photoDetails[
                              this.props.idx2hash[this.props.lightboxImageIndex]
                            ].captions_json.places365.attributes.map(
                              (nc, idx) => (
                                <Label
                                  key={
                                    "lightbox_attribute_label_" +
                                    this.props.idx2hash[
                                      this.props.lightboxImageIndex
                                    ] +
                                    "_" +
                                    nc
                                  }
                                  tag
                                  color={
                                    colors[
                                      idx %
                                        this.props.photoDetails[
                                          this.props.idx2hash[
                                            this.props.lightboxImageIndex
                                          ]
                                        ].search_captions.split(" , ").length
                                    ]
                                  }
                                  color="blue"
                                  onClick={() => {
                                    this.props.dispatch(searchPhotos(nc));
                                    this.props.dispatch(push("/search"));
                                  }}
                                >
                                  {nc}
                                </Label>
                              )
                            )}
                          </Label.Group>
                          <p>
                            <b>Categories</b>
                          </p>
                          <Label.Group>
                            {this.props.photoDetails[
                              this.props.idx2hash[this.props.lightboxImageIndex]
                            ].captions_json.places365.categories.map(
                              (nc, idx) => (
                                <Label
                                  key={
                                    "lightbox_category_label_" +
                                    this.props.idx2hash[
                                      this.props.lightboxImageIndex
                                    ] +
                                    "_" +
                                    nc
                                  }
                                  tag
                                  color={
                                    colors[
                                      idx %
                                        this.props.photoDetails[
                                          this.props.idx2hash[
                                            this.props.lightboxImageIndex
                                          ]
                                        ].search_captions.split(" , ").length
                                    ]
                                  }
                                  color="teal"
                                  onClick={() => {
                                    this.props.dispatch(searchPhotos(nc));
                                    this.props.dispatch(push("/search"));
                                  }}
                                >
                                  {nc}
                                </Label>
                              )
                            )}
                          </Label.Group>
                        </Item.Description>
                      </Item.Content>
                    </Item>
                  </Item.Group>
                </div>
              </div>
            )}
          </div>
        </Transition>
      </div>
    );
  }
}

LightBox = connect(store => {
  return {
    auth: store.auth,
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
    generatingCaptionIm2txt: store.photos.generatingCaptionIm2txt,
    generatedCaptionIm2txt: store.photos.generatedCaptionIm2txt,
    photos: store.photos.photos
    // idx2hash: store.albums.idx2hash,
    // albumsDatePhotoHashList: store.albums.albumsDatePhotoHashList,
    // fetchingAlbumsDatePhotoHashList: store.albums.fetchingAlbumsDatePhotoHashList,
    // fetchedAlbumsDatePhotoHashList: store.albums.fetchedAlbumsDatePhotoHashList,
  };
})(LightBox);
