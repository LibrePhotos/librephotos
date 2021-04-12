import React, { Component } from "react";
import "react-virtualized/styles.css"; // only needs to be imported once
import { connect } from "react-redux";
import { copyToClipboard } from "../util/util";
import {
  setPhotosFavorite,
  setPhotosHidden,
  setPhotosPublic,
  generatePhotoIm2txtCaption
} from "../actions/photosActions";
import {
  Image,
  Header,
  Item,
  Form,
  List as ListSUI,
  Label,
  Button,
  Icon,
  Transition,
  Breadcrumb
} from "semantic-ui-react";
import { serverAddress, shareAddress } from "../api_client/apiClient";
import Lightbox from "react-image-lightbox";
import { LocationMap } from "../components/maps";
import { push } from "react-router-redux";
import { searchPhotos } from "../actions/searchActions";
import * as moment from "moment";
import { Link } from "react-router-dom";

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
    if (
      !this.props.photoDetails[
        this.props.idx2hash.slice(this.props.lightboxImageIndex)[0]
      ]
    ) {
      console.log("light box has not gotten main photo detail");
      var mainSrc = "/transparentbackground.png";
    } else {
      console.log("light box has got main photo detail");
      var mainSrc = serverAddress +
       "/media/thumbnails_big/" +
        this.props.idx2hash.slice(this.props.lightboxImageIndex)[0] +
        ".jpg";
      if (
        this.props.photoDetails[
          this.props.idx2hash.slice(this.props.lightboxImageIndex)[0]
        ].hidden &&
        !this.props.showHidden
      ) {
        var mainSrc = "/hidden.png";
      }

      for (var i = 0; i < 10; i++) {
        setTimeout(() => {

          // Fix large wide images when side bar open; retry once per 250ms over 2.5 seconds
          if (document.getElementsByClassName('ril-image-current').length > 0) {
            this.state.wideImg = (document.getElementsByClassName('ril-image-current')[0].naturalWidth > window.innerWidth);

            // 360px side bar /2 = 180px to the left = re-centers a wide image
            var translate = (this.state.lightboxSidebarShow && this.state.wideImg) ? `-180px` : '';

            if (document.getElementsByClassName('ril-image-current')[0].style.left !== translate) {
              document.getElementsByClassName('ril-image-current')[0].style.left = translate;

              // Fix react-image-lightbox
              // It did not re-calculate the image_prev and image_next when pressed left or right arrow key
              // It only updated those offsets on render / scroll / double click to zoom / etc.
              this.forceUpdate();
            }

            // Since we disabled animations, we can set image_prev and image_next visibility hidden
            // Fixes prev/next large wide 16:9 images were visible at same time as main small 9:16 image in view
            document.getElementsByClassName('ril-image-prev')[0].style.visibility = 'hidden';
            document.getElementsByClassName('ril-image-next')[0].style.visibility = 'hidden';
            document.getElementsByClassName('ril-image-current')[0].style.visibility = 'visible';

            // Make toolbar background fully transparent
            if (document.getElementsByClassName('ril-toolbar').length > 0) {
              document.getElementsByClassName('ril-toolbar')[0].style.backgroundColor = 'rgba(0, 0, 0, 0)';
            }
          }
        }, 250*i);
      }
    }

    return (
      <div>
        <Lightbox
          animationDisabled={true}
          mainSrc={mainSrc}
          nextSrc={
            serverAddress +
            "/media/thumbnails_big/" +
            this.props.idx2hash.slice(
              (this.props.lightboxImageIndex + 1) % this.props.idx2hash.length
            )[0] +
            ".jpg"
          }
          prevSrc={
            serverAddress +
            "/media/thumbnails_big/" +
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

{/* Start Item Time Taken */}

                    <Item>
                      <Item.Content verticalAlign="middle">
                        <Item.Header>
                          <Icon name="calendar" /> Time Taken
                        </Item.Header>
                        <Item.Description>
                          {moment.utc(
                            this.props.photoDetails[
                              this.props.idx2hash[this.props.lightboxImageIndex]
                            ].exif_timestamp
                          ).format("dddd, MMMM Do YYYY, h:mm a")}
                        </Item.Description>
                      </Item.Content>
                    </Item>

{/* End Item Time Taken */}
{/* Start Item File Path */}

                    <Item>
                      <Item.Content verticalAlign="middle">
                        <Item.Header>
                          <Icon name="file" /> File Path
                        </Item.Header>
                        <Item.Description>
                          <Breadcrumb
                            as={Link}
                            to={serverAddress+'/media/photos/'+this.props.idx2hash[this.props.lightboxImageIndex]+'.jpg'}
                            target='_blank'
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

{/* End Item File Path */}
{/* Start Item Location */}

                    {
                            this.props.photoDetails[
                              this.props.idx2hash[this.props.lightboxImageIndex]
                            ].search_location &&
                    (<Item>
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
                    </Item>)
                    }

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
                          zoom={16}
                          photos={[
                            this.props.photoDetails[
                              this.props.idx2hash[this.props.lightboxImageIndex]
                            ]
                          ]}
                        />
                      )}
                    </div>

{/* End Item Location */}
{/* Start Item People */}

                    {
                            this.props.photoDetails[
                              this.props.idx2hash[this.props.lightboxImageIndex]
                            ].people.length > 0 &&
                    (<Item>
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
                    </Item>)
                    }

{/* End Item People */}
{/* Start Item Caption */}

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

{/* End Item Caption */}
{/* Start Item Scene */}

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

{/* End Item Scene */}
{/* Start Item Similar Photos */}

                    <Item>
                      <Item.Content verticalAlign="middle">
                        <Item.Header>
                          <Icon name="images"/>Similar Photos
                        </Item.Header>
                        <Item.Description>
                          <Image.Group>
                          {
                                this.props.photoDetails[
                                  this.props.idx2hash[
                                    this.props.lightboxImageIndex
                                  ]
                                ].similar_photos.slice(0,30).map(el=>(
                                  <Image width={95} height={95}
                                    src={serverAddress+"/media/square_thumbnails_small/"+el.image_hash+".jpg"}/>
                                ))
                          }
                          </Image.Group>
                        </Item.Description>
                      </Item.Content>
                    </Item>

{/* End Item Similar Photos */}

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
  };
})(LightBox);
