import React, { Component } from "react";
import "react-virtualized/styles.css"; // only needs to be imported once
import { generatePhotoIm2txtCaption } from "../../actions/photosActions";
import { Button, Input, Image, Header, Item, Form, Label, Icon, Transition, Breadcrumb } from "semantic-ui-react";
import { connect } from "react-redux";
import { serverAddress } from "../../api_client/apiClient";
import { LocationMap } from "../maps";
import { push } from "connected-react-router";
import { searchPhotos } from "../../actions/searchActions";
import * as moment from "moment";
import { Link } from "react-router-dom";
import { Tile } from "../Tile";
import { withTranslation, Trans } from "react-i18next";
import { compose } from "redux";
import { TimestampItem } from "./TimestampItem";
var LIGHTBOX_SIDEBAR_WIDTH = 360;
if (window.innerWidth < 600) {
  LIGHTBOX_SIDEBAR_WIDTH = window.innerWidth;
}

const colors = ["red", "orange", "yellow", "olive", "green", "teal", "blue", "violet", "purple", "pink", "brown", "grey", "black"];

export default class Sidebar extends Component {
  constructor(props) {
    super(props);
  }

  render() {
    return (
      <Transition visible={this.props.lightboxSidebarShow} animation="fade left" duration={500}>
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
            zIndex: 250,
          }}
        >
          {this.props.photoDetail && (
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
                    this.props.closeSidepanel();
                  }}
                />
                <Header as="h3">Details</Header>

                <Item.Group relaxed>
                  {/* Start Item Time Taken */}
                  <TimestampItem photoDetail={this.props.photoDetail} dispatch={this.props.dispatch}></TimestampItem>
                  {/* End Item Time Taken */}
                  {/* Start Item File Path */}

                  <Item>
                    <Item.Content verticalAlign="middle">
                      <Item.Header>
                        <Icon name="file" /> {this.props.t("lightbox.sidebar.filepath")}
                      </Item.Header>
                      <Item.Description>
                        <Breadcrumb
                          as={Link}
                          to={serverAddress + "/media/photos/" + this.props.photoDetail.image_hash + ".jpg"}
                          target="_blank"
                          divider="/"
                          sections={this.props.photoDetail.image_path.split("/").map((el) => {
                            return { key: el, content: el };
                          })}
                        />
                      </Item.Description>
                    </Item.Content>
                  </Item>

                  {/* End Item File Path */}
                  {/* Start Item Location */}

                  {this.props.photoDetail.search_location && (
                    <Item>
                      <Item.Content verticalAlign="middle">
                        <Item.Header>
                          <Icon name="point" /> {this.props.t("lightbox.sidebar.location")}
                        </Item.Header>
                        <Item.Description>{this.props.photoDetail.search_location}</Item.Description>
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
                    {this.props.photoDetail.exif_gps_lat && <LocationMap zoom={16} photos={[this.props.photoDetail]} />}
                  </div>

                  {/* End Item Location */}
                  {/* Start Item People */}

                  {this.props.photoDetail.people.length > 0 && (
                    <Item>
                      <Item.Content verticalAlign="middle">
                        <Item.Header>
                          <Icon name="users" /> {this.props.t("lightbox.sidebar.people")}
                        </Item.Header>
                        <Item.Description>
                          <Label.Group>
                            {this.props.photoDetail.people.map((nc, idx) => (
                              <Label
                                color={colors[idx % this.props.photoDetail.people.length]}
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
                  )}

                  {/* End Item People */}
                  {/* Start Item Caption */}

                  <Item>
                    <Item.Content verticalAlign="middle">
                      <Item.Header>
                        <Icon name="write" /> {this.props.t("lightbox.sidebar.caption")}
                      </Item.Header>
                      <Item.Description>
                        {false && this.props.photoDetail.captions_json.im2txt}
                        <Form>
                          <Form.TextArea disabled={this.props.isPublic} fluid placeholder={this.props.photoDetail.captions_json.im2txt}>
                            {this.props.photoDetail.captions_json.im2txt}
                          </Form.TextArea>
                          <Button disabled={this.props.isPublic} floated="left" size="small" color="green">
                            {this.props.t("lightbox.sidebar.submit")}
                          </Button>
                          <Button
                            loading={this.props.generatingCaptionIm2txt}
                            onClick={() => {
                              this.props.dispatch(generatePhotoIm2txtCaption(this.props.photoDetail.image_hash));
                            }}
                            disabled={this.props.isPublic | (this.props.generatingCaptionIm2txt != null && this.props.generatingCaptionIm2txt)}
                            floated="left"
                            size="small"
                            color="blue"
                          >
                            {this.props.t("lightbox.sidebar.generate")}
                          </Button>
                          <Button disabled={this.props.isPublic} floated="right" size="small" basic>
                            {this.props.t("lightbox.sidebar.cancel")}
                          </Button>
                        </Form>
                      </Item.Description>
                    </Item.Content>
                  </Item>

                  {/* End Item Caption */}
                  {/* Start Item Scene */}
                  {this.props.photoDetail.captions_json.places365 && (
                    <Item>
                      <Item.Content verticalAlign="middle">
                        <Item.Header>
                          <Icon name="tags" /> {this.props.t("lightbox.sidebar.scene")}
                        </Item.Header>
                        <Item.Description>
                          <p>
                            <b>{this.props.t("lightbox.sidebar.attributes")}</b>
                          </p>
                          <Label.Group>
                            {this.props.photoDetail.captions_json.places365.attributes.map((nc, idx) => (
                              <Label
                                key={"lightbox_attribute_label_" + this.props.photoDetail.image_hash + "_" + nc}
                                tag
                                color="blue"
                                onClick={() => {
                                  this.props.dispatch(searchPhotos(nc));
                                  this.props.dispatch(push("/search"));
                                }}
                              >
                                {nc}
                              </Label>
                            ))}
                          </Label.Group>

                          <p>
                            <b>{this.props.t("lightbox.sidebar.categories")}</b>
                          </p>
                          <Label.Group>
                            {this.props.photoDetail.captions_json.places365.categories.map((nc, idx) => (
                              <Label
                                key={"lightbox_category_label_" + this.props.photoDetail.image_hash + "_" + nc}
                                tag
                                color="teal"
                                onClick={() => {
                                  this.props.dispatch(searchPhotos(nc));
                                  this.props.dispatch(push("/search"));
                                }}
                              >
                                {nc}
                              </Label>
                            ))}
                          </Label.Group>
                        </Item.Description>
                      </Item.Content>
                    </Item>
                  )}
                  {/* End Item Scene */}
                  {/* Start Item Similar Photos */}
                  {this.props.photoDetail.similar_photos.length > 0 && (
                    <Item>
                      <Item.Content verticalAlign="middle">
                        <Item.Header>
                          <Icon name="images" />
                          {this.props.t("lightbox.sidebar.similarphotos")}
                        </Item.Header>
                        <Item.Description>
                          <Image.Group>
                            {this.props.photoDetail.similar_photos.slice(0, 30).map((el) => (
                              <Tile video={el.type.includes("video")} height={95} width={95} image_hash={el.image_hash} />
                            ))}
                            ;
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
}

Sidebar = compose(
  connect((store) => {
    return {
      generatingCaptionIm2txt: store.photos.generatingCaptionIm2txt,
    };
  }),
  withTranslation()
)(Sidebar);
