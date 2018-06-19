import React, { Component } from "react";
import {
  Form,
  Radio,
  Label,
  Step,
  Progress,
  List,
  Grid,
  Image,
  Icon,
  Item,
  Header,
  Segment,
  Accordion,
  Container,
  Message,
  Divider,
  Button,
  Loader,
  Dropdown,
  Popup
} from "semantic-ui-react";
import { connect } from "react-redux";

import {
  fetchCountStats,
  fetchPhotoScanStatus,
  fetchWordCloud,
  generateEventAlbums,
  fetchAutoAlbumProcessingStatus,
  generateEventAlbumTitles,
  fetchWorkerAvailability,
  setSiteSettings,
  fetchSiteSettings
} from "../actions/utilActions";
import { scanPhotos, fetchPhotos } from "../actions/photosActions";

import CountryPiChart from "../components/charts/countryPiChart";
import { CountStats } from "../components/statistics";
import WordCloud from "../components/charts/wordCloud";

import { AllPhotosMap, EventMap, LocationClusterMap } from "../components/maps";
import EventCountMonthGraph from "../components/eventCountMonthGraph";
import FaceClusterScatter from "../components/faceClusterGraph";
import SocialGraph from "../components/socialGraph";
import LazyLoad from "react-lazyload";
import { LocationLink } from "../components/locationLink";

export class Settings extends Component {
  state = {
    accordionOneActive: false,
    accordionTwoActive: false,
    accordionThreeActive: false,
    accordionFourActive: false
  };

  onPhotoScanButtonClick = e => {
    this.props.dispatch(scanPhotos());
  };

  onGenerateEventAlbumsButtonClick = e => {
    this.props.dispatch(generateEventAlbums());
  };

  componentDidMount() {
    this.props.dispatch(fetchSiteSettings());
  }

  render() {
    var buttonsDisabled = !this.props.workerAvailability;

    console.log(this.props.siteSettings);
    return (
      <div style={{ padding: 10 }}>
        <Header as="h2">Settings</Header>

        <Divider hidden />

        <div>
          <Header as="h3">Account Settings</Header>

          <Grid>
            <Grid.Row>
              <Grid.Column width={5} textAlign="right">
                <b>Scan Directory</b>
              </Grid.Column>

              <Grid.Column width={11}>
                {this.props.auth.access.scan_directory}
              </Grid.Column>
            </Grid.Row>
            <Grid.Row>
              <Grid.Column width={5} textAlign="right">
                <b>Account Information</b>
              </Grid.Column>

              <Grid.Column width={11}>
                <Form>
                  <Form.Group widths="equal">
                    <Form.Input
                      fluid
                      label="First name"
                      placeholder="First name"
                    />
                    <Form.Input
                      fluid
                      label="Last name"
                      placeholder="Last name"
                    />
                  </Form.Group>
                  <Form.Button>Submit</Form.Button>
                </Form>{" "}
              </Grid.Column>
            </Grid.Row>
          </Grid>

          <Divider hidden />
        </div>

        {this.props.auth.access.is_admin && (
          <div>
            <Header as="h3">
              Site settings<Label color="red" size="mini">
                Admin
              </Label>
            </Header>

            <Grid>
              <Grid.Row>
                <Grid.Column width={5} textAlign="right">
                  <b>Allow user registration</b>
                </Grid.Column>

                <Grid.Column width={11}>
                  <Form>
                    <Form.Group>
                      <Form.Field>
                        <Radio
                          label="Allow"
                          name="radioGroup"
                          onChange={() =>
                            this.props.dispatch(
                              setSiteSettings({ allow_registration: true })
                            )
                          }
                          checked={this.props.siteSettings.allow_registration}
                        />
                      </Form.Field>
                      <Form.Field>
                        <Radio
                          label="Do not allow"
                          name="radioGroup"
                          onChange={() =>
                            this.props.dispatch(
                              setSiteSettings({ allow_registration: false })
                            )
                          }
                          checked={!this.props.siteSettings.allow_registration}
                        />
                      </Form.Field>
                    </Form.Group>
                  </Form>
                </Grid.Column>
              </Grid.Row>
            </Grid>

            <Divider hidden />
          </div>
        )}

        <Header as="h3">Appearance settings</Header>

        <Grid>
          <Grid.Row>
            <Grid.Column width={5} textAlign="right">
              <b>Thumbnail size</b>
            </Grid.Column>

            <Grid.Column width={11}>
              <Form>
                <Form.Group>
                  <Form.Field>
                    <Radio
                      label="Big"
                      name="radioGroup"
                      value="loose"
                      onChange={() =>
                        this.props.dispatch({
                          type: "SET_GRID_TYPE",
                          payload: "loose"
                        })
                      }
                      checked={this.props.gridType === "loose"}
                    />
                  </Form.Field>
                  <Form.Field>
                    <Radio
                      label="Small"
                      name="radioGroup"
                      value="dense"
                      onChange={() =>
                        this.props.dispatch({
                          type: "SET_GRID_TYPE",
                          payload: "dense"
                        })
                      }
                      checked={this.props.gridType === "dense"}
                    />
                  </Form.Field>
                </Form.Group>
              </Form>
            </Grid.Column>
          </Grid.Row>
        </Grid>

        <Divider hidden />

        <Header as="h3">Library actions</Header>

        <Grid>
          <Grid.Row>
            <Grid.Column width={5} textAlign="right">
              <b>Scan Photos</b>
            </Grid.Column>

            <Grid.Column width={11}>
              <Popup
                trigger={
                  <Button
                    size="mini"
                    onClick={this.onPhotoScanButtonClick}
                    disabled={buttonsDisabled}
                    color="blue"
                  >
                    <Icon
                      name="refresh"
                      loading={
                        this.props.statusPhotoScan.status &&
                        this.props.statusPhotoScan.added
                      }
                    />
                    {this.props.statusPhotoScan.added
                      ? "Scanning Photos " +
                        `(${this.props.statusPhotoScan.added}/${
                          this.props.statusPhotoScan.to_add
                        })`
                      : "Start"}
                  </Button>
                }
              >
                <Header>The backend server will:</Header>

                <List bulleted>
                  <List.Item>
                    Make a list of all jpg files in subdirectories. For each jpg
                    file:
                  </List.Item>
                  <List.Item>
                    If the filepath exists in the database, we skip.
                  </List.Item>
                  <List.Item>
                    Calculate a unique ID of the image file (md5)
                  </List.Item>
                  <List.Item>
                    If this image file is already in the database, we skip.
                  </List.Item>
                  <List.Item>Generate a number of thumbnails </List.Item>
                  <List.Item>Generate image captions </List.Item>
                  <List.Item>Extract Exif information </List.Item>
                  <List.Item>
                    Reverse geolocate to get location names from GPS coordinates{" "}
                  </List.Item>
                  <List.Item>Extract faces. </List.Item>
                  <List.Item>Add photo to thing and place albums. </List.Item>
                </List>
              </Popup>
            </Grid.Column>
          </Grid.Row>

          <Grid.Row>
            <Grid.Column width={5} textAlign="right">
              <b>Make Event Albums</b>
            </Grid.Column>

            <Grid.Column width={11}>
              <Popup
                trigger={
                  <Button
                    size="mini"
                    attached={this.state.accordionTwoActive ? "bottom" : false}
                    onClick={this.onGenerateEventAlbumsButtonClick}
                    disabled={buttonsDisabled}
                    color="green"
                  >
                    <Icon name="wizard" />Start
                  </Button>
                }
              >
                <Header>The backend server will:</Header>

                <p>
                  First group photos by time taken. If two consecutive photos
                  are taken within 12 hours of each other, the two photos are
                  considered to be from the same event. After groups are put
                  together in this way, it automatically generates a title for
                  this album.
                </p>
              </Popup>
            </Grid.Column>
          </Grid.Row>

          <Grid.Row>
            <Grid.Column width={5} textAlign="right">
              <b>Regenerate Event Titles</b>
            </Grid.Column>

            <Grid.Column width={11}>
              <Popup
                trigger={
                  <Button
                    size="mini"
                    attached={
                      this.state.accordionThreeActive ? "bottom" : false
                    }
                    onClick={() => {
                      this.props.dispatch(generateEventAlbumTitles());
                    }}
                    indicating="true"
                    disabled={buttonsDisabled}
                    color="brown"
                  >
                    <Icon name="wizard" />Start
                  </Button>
                }
              >
                <Header>What's this for?</Header>

                <p>
                  Automatically generated albums have names of people in the
                  titles. If you trained your face classifier after making event
                  albums, you can generate new titles for already existing event
                  albums to reflect the new names associated with the faces in
                  photos.
                </p>
              </Popup>
            </Grid.Column>
          </Grid.Row>
        </Grid>
      </div>
    );
  }
}

Settings = connect(store => {
  return {
    auth: store.auth,
    gridType: store.ui.gridType,
    siteSettings: store.util.siteSettings,
    statusPhotoScan: store.util.statusPhotoScan,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
    generatingAutoAlbums: store.util.generatingAutoAlbums,
    scanningPhotos: store.photos.scanningPhotos,
    fetchedCountStats: store.util.fetchedCountStats,
    workerAvailability: store.util.workerAvailability
  };
})(Settings);
