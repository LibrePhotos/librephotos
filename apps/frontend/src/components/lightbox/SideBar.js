import React from "react";
import "react-virtualized/styles.css"; // only needs to be imported once
import { generatePhotoIm2txtCaption } from "../../actions/photosActions";
import {
  Image,
  Header,
  Item,
  Form,
  Label,
  Button,
  Icon,
  Modal,
  Transition,
  Breadcrumb,
} from "semantic-ui-react";
import { serverAddress } from "../../api_client/apiClient";
import { LocationMap } from "../../components/maps";
import { push } from "react-router-redux";
import { searchPhotos } from "../../actions/searchActions";
import * as moment from "moment";
import { Link } from "react-router-dom";

var LIGHTBOX_SIDEBAR_WIDTH = 360;
if (window.innerWidth < 600) {
  LIGHTBOX_SIDEBAR_WIDTH = window.innerWidth;
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
  "black",
];

export default function getSideBar(box) {
  return (
    <Transition
      visible={box.state.lightboxSidebarShow}
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
          zIndex: 1200,
        }}
      >
        {box.props.photoDetails.hasOwnProperty(
          box.props.idx2hash[box.props.lightboxImageIndex].id
        ) && (
          <div style={{ width: LIGHTBOX_SIDEBAR_WIDTH }}>
            <div
              style={{
                paddingLeft: 30,
                paddingRight: 30,
                fontSize: "14px",
                lineHeight: "normal",
                whiteSpace: "normal",
                wordWrap: "break-all",
              }}
            >
              <Button
                floated="right"
                circular
                icon="close"
                onClick={() => {
                  box.setState({ lightboxSidebarShow: false });
                  box.forceUpdate();
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
                      {moment
                        .utc(
                          box.props.photoDetails[
                            box.props.idx2hash[box.props.lightboxImageIndex].id
                          ].exif_timestamp
                        )
                        .format("dddd, MMMM Do YYYY, h:mm a")}
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
                        to={
                          serverAddress +
                          "/media/photos/" +
                          box.props.idx2hash[box.props.lightboxImageIndex].id +
                          ".jpg"
                        }
                        target="_blank"
                        divider="/"
                        sections={box.props.photoDetails[
                          box.props.idx2hash[box.props.lightboxImageIndex].id
                        ].image_path
                          .split("/")
                          .map((el) => {
                            return { key: el, content: el };
                          })}
                      />
                    </Item.Description>
                  </Item.Content>
                </Item>

                {/* End Item File Path */}
                {/* Start Item Location */}

                {box.props.photoDetails[
                  box.props.idx2hash[box.props.lightboxImageIndex].id
                ].search_location && (
                  <Item>
                    <Item.Content verticalAlign="middle">
                      <Item.Header>
                        <Icon name="point" /> Location
                      </Item.Header>
                      <Item.Description>
                        {
                          box.props.photoDetails[
                            box.props.idx2hash[box.props.lightboxImageIndex].id
                          ].search_location
                        }
                      </Item.Description>
                    </Item.Content>
                  </Item>
                )}

                <div
                  style={{
                    width: LIGHTBOX_SIDEBAR_WIDTH - 70,
                    whiteSpace: "normal",
                    lineHeight: "normal",
                  }}
                >
                  {box.props.photoDetails[
                    box.props.idx2hash[box.props.lightboxImageIndex].id
                  ].exif_gps_lat && (
                    <LocationMap
                      zoom={16}
                      photos={[
                        box.props.photoDetails[
                          box.props.idx2hash[box.props.lightboxImageIndex].id
                        ],
                      ]}
                    />
                  )}
                </div>

                {/* End Item Location */}
                {/* Start Item People */}

                {box.props.photoDetails[
                  box.props.idx2hash[box.props.lightboxImageIndex].id
                ].people.length > 0 && (
                  <Item>
                    <Item.Content verticalAlign="middle">
                      <Item.Header>
                        <Icon name="users" /> People
                      </Item.Header>
                      <Item.Description>
                        <Label.Group>
                          {box.props.photoDetails[
                            box.props.idx2hash[box.props.lightboxImageIndex].id
                          ].people.map((nc, idx) => (
                            <Label
                              color={
                                colors[
                                  idx %
                                    box.props.photoDetails[
                                      box.props.idx2hash[
                                        box.props.lightboxImageIndex
                                      ].id
                                    ].people.length
                                ]
                              }
                              onClick={() => {
                                box.props.dispatch(searchPhotos(nc));
                                box.props.dispatch(push("/search"));
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
                )}

                {/* End Item People */}
                {/* Start Item Caption */}

                <Item>
                  <Item.Content verticalAlign="middle">
                    <Item.Header>
                      <Icon name="write" /> Caption
                    </Item.Header>
                    <Item.Description>
                      {false &&
                        box.props.photoDetails[
                          box.props.idx2hash[box.props.lightboxImageIndex].id
                        ].captions_json.im2txt}
                      <Form>
                        <Form.TextArea
                          disabled={box.props.isPublic}
                          fluid
                          placeholder={
                            box.props.photoDetails[
                              box.props.idx2hash[box.props.lightboxImageIndex]
                                .id
                            ].captions_json.im2txt
                          }
                        >
                          {
                            box.props.photoDetails[
                              box.props.idx2hash[box.props.lightboxImageIndex]
                                .id
                            ].captions_json.im2txt
                          }
                        </Form.TextArea>
                        <Button
                          disabled={box.props.isPublic}
                          floated="left"
                          size="small"
                          color="green"
                        >
                          Submit
                        </Button>
                        <Button
                          loading={box.props.generatingCaptionIm2txt}
                          onClick={() => {
                            box.props.dispatch(
                              generatePhotoIm2txtCaption(
                                box.props.idx2hash[box.props.lightboxImageIndex]
                                  .id
                              )
                            );
                          }}
                          disabled={
                            box.props.isPublic |
                            (box.props.generatingCaptionIm2txt != null &&
                              box.props.generatingCaptionIm2txt)
                          }
                          floated="left"
                          size="small"
                          color="blue"
                        >
                          Generate
                        </Button>
                        <Button
                          disabled={box.props.isPublic}
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
                {box.props.photoDetails[
                  box.props.idx2hash[box.props.lightboxImageIndex].id
                ].captions_json.places365 && (
                  <div>
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
                            {box.props.photoDetails[
                              box.props.idx2hash[box.props.lightboxImageIndex]
                                .id
                            ].captions_json.places365.attributes.map(
                              (nc, idx) => (
                                <Label
                                  key={
                                    "lightbox_attribute_label_" +
                                    box.props.idx2hash[
                                      box.props.lightboxImageIndex
                                    ].id +
                                    "_" +
                                    nc
                                  }
                                  tag
                                  color="blue"
                                  onClick={() => {
                                    box.props.dispatch(searchPhotos(nc));
                                    box.props.dispatch(push("/search"));
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
                            {box.props.photoDetails[
                              box.props.idx2hash[box.props.lightboxImageIndex]
                                .id
                            ].captions_json.places365.categories.map(
                              (nc, idx) => (
                                <Label
                                  key={
                                    "lightbox_category_label_" +
                                    box.props.idx2hash[
                                      box.props.lightboxImageIndex
                                    ].id +
                                    "_" +
                                    nc
                                  }
                                  tag
                                  color="teal"
                                  onClick={() => {
                                    box.props.dispatch(searchPhotos(nc));
                                    box.props.dispatch(push("/search"));
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
                  </div>
                )}
                {/* End Item Scene */}
                {/* Start Item Similar Photos */}
                {box.props.photoDetails[
                  box.props.idx2hash[box.props.lightboxImageIndex].id
                ].similar_photos.length > 0 && (
                  <Item>
                    <Item.Content verticalAlign="middle">
                      <Item.Header>
                        <Icon name="images" />
                        Similar Photos
                      </Item.Header>
                      <Item.Description>
                        <Image.Group>
                          {box.props.photoDetails[
                            box.props.idx2hash[box.props.lightboxImageIndex].id
                          ].similar_photos
                            .slice(0, 30)
                            .map((el) => (
                              <Image
                                width={95}
                                height={95}
                                key={el.image_hash}
                                src={
                                  serverAddress +
                                  "/media/square_thumbnails_small/" +
                                  el.image_hash +
                                  ".jpg"
                                }
                              />
                            ))}
                        </Image.Group>
                      </Item.Description>
                    </Item.Content>
                  </Item>
                )}
                {/* End Item Similar Photos */}
              </Item.Group>
            </div>
          </div>
        )}
      </div>
    </Transition>
  );
}
