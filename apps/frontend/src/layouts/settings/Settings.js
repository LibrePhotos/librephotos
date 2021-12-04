import React, { Component } from "react";
import { compose } from "redux";
import {
  Form,
  Radio,
  List,
  Grid,
  Icon,
  Header,
  Segment,
  Input,
  Button,
  Table,
  Popup,
  Divider,
  Confirm,
  Dropdown,
} from "semantic-ui-react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import Modal from "react-modal";
import {
  fetchCountStats,
  generateEventAlbums,
  generateEventAlbumTitles,
  fetchSiteSettings,
  updateAvatar,
  updateUser,
  manageUpdateUser,
  fetchNextcloudDirectoryTree,
  fetchJobList,
  deleteMissingPhotos,
} from "../../actions/utilActions";
import { rescanFaces, trainFaces } from "../../actions/facesActions";
import {
  scanPhotos,
  scanAllPhotos,
  scanNextcloudPhotos,
} from "../../actions/photosActions";
import { fetchUserSelfDetails } from "../../actions/userActions";
import { CountStats } from "../../components/statistics";
import Dropzone from "react-dropzone";
import AvatarEditor from "react-avatar-editor";
import MaterialIcon from "material-icons-react";
import SortableTree from "react-sortable-tree";
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";
import { serverAddress } from "../../api_client/apiClient";
import { withTranslation, Trans } from "react-i18next";

export class Settings extends Component {
  state = {
    accordionOneActive: false,
    accordionTwoActive: false,
    accordionThreeActive: false,
    accordionFourActive: false,
    open: false,
    avatarImgSrc: "/unknown_user.jpg",
    userSelfDetails: {},
    modalNextcloudScanDirectoryOpen: false,
  };
  open = () => this.setState({ open: true });
  close = () => this.setState({ open: false });

  setEditorRef = (editor) => (this.editor = editor);

  constructor(props) {
    super(props);
    this.dropzoneRef = React.createRef();
  }

  onPhotoScanButtonClick = (e) => {
    this.props.dispatch(scanPhotos());
  };

  onPhotoFullScanButtonClick = (e) => {
    this.props.dispatch(scanAllPhotos());
  };

  onGenerateEventAlbumsButtonClick = (e) => {
    this.props.dispatch(generateEventAlbums());
  };

  onDeleteMissingPhotosButtonClick = (e) => {
    this.props.dispatch(deleteMissingPhotos());
    this.close();
  };

  urltoFile = (url, filename, mimeType) => {
    mimeType = mimeType || (url.match(/^data:([^;]+);/) || "")[1];
    return fetch(url)
      .then(function (res) {
        return res.arrayBuffer();
      })
      .then(function (buf) {
        return new File([buf], filename, { type: mimeType });
      });
  };

  componentDidMount() {
    this.props.dispatch(fetchCountStats());
    this.props.dispatch(fetchSiteSettings());
    this.props.dispatch(fetchUserSelfDetails(this.props.auth.access.user_id));
    this.props.dispatch(fetchNextcloudDirectoryTree("/"));
    if (this.props.auth.access.is_admin) {
      this.props.dispatch(fetchJobList());
    }
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    if (
      !prevState.userSelfDetails.id &&
      nextProps.userSelfDetails &&
      nextProps.userSelfDetails.id
    ) {
      return { ...prevState, userSelfDetails: nextProps.userSelfDetails };
    }

    return prevState;
  }

  render() {
    let buttonsDisabled = !this.props.workerAvailability;
    buttonsDisabled = false;
    if (this.state.avatarImgSrc === "/unknown_user.jpg") {
      if (this.props.userSelfDetails.avatar_url) {
        this.setState({
          avatarImgSrc: serverAddress + this.props.userSelfDetails.avatar_url,
        });
      }
    }
    return (
      <div style={{ padding: 10 }}>
        <Header as="h2">
          <MaterialIcon icon="settings" color="#000000" size={32} />
          <Header.Content>
            <Trans i18nKey="settings.header">Settings</Trans>
          </Header.Content>
        </Header>
        <div>
          <Header as="h3">
            <Trans i18nKey="settings.account">Account</Trans>
          </Header>

          <Grid>
            <Grid.Row>
              <Grid.Column width={4} textAlign="left">
                <b>
                  <Trans i18nKey="settings.avatar">Public Avatar</Trans>
                </b>
              </Grid.Column>

              <Grid.Column width={12}>
                <div
                  style={{
                    display: "inline-block",
                    verticalAlign: "top",
                    padding: 5,
                  }}
                >
                  <Dropzone
                    disableClick
                    style={{ width: 150, height: 150, borderRadius: 75 }}
                    ref={(node) => {
                      this.dropzoneRef = node;
                    }}
                    onDrop={(accepted, rejected) => {
                      this.setState({
                        avatarImgSrc: accepted[0].preview,
                      });
                    }}
                  >
                    <AvatarEditor
                      ref={this.setEditorRef}
                      width={150}
                      height={150}
                      border={0}
                      image={this.state.avatarImgSrc}
                    />
                  </Dropzone>
                </div>
                <div
                  style={{
                    display: "inline-block",
                    verticalAlign: "top",
                    padding: 5,
                  }}
                >
                  <p>
                    <b>
                      <Trans i18nKey="settings.uploadheader">
                        Upload new avatar
                      </Trans>
                    </b>
                  </p>
                  <Button
                    size="small"
                    onClick={() => {
                      this.dropzoneRef.open();
                    }}
                  >
                    <Icon name="image" />
                    <Trans i18nKey="settings.image">Choose image</Trans>
                  </Button>
                  <Button
                    size="small"
                    color="green"
                    onClick={() => {
                      let form_data = new FormData();
                      this.urltoFile(
                        this.editor.getImageScaledToCanvas().toDataURL(),
                        this.state.userSelfDetails.first_name + "avatar.png"
                      ).then((file) => {
                        form_data.append(
                          "avatar",
                          file,
                          this.state.userSelfDetails.first_name + "avatar.png"
                        );
                        this.props.dispatch(
                          updateAvatar(this.state.userSelfDetails, form_data)
                        );
                      });
                    }}
                  >
                    <Icon name="upload" />
                    <Trans i18nKey="settings.upload">Upload</Trans>
                  </Button>
                  <p>
                    <Trans i18nKey="settings.filesize">
                      The maximum file size allowed is 200KB.
                    </Trans>
                  </p>
                </div>
              </Grid.Column>
            </Grid.Row>

            <Grid.Row>
              <Grid.Column width={4} textAlign="left">
                <b>
                  <Trans i18nKey="settings.accountinformation">
                    Account Information
                  </Trans>
                </b>
              </Grid.Column>

              <Grid.Column width={12}>
                <Form>
                  <Form.Group widths="equal">
                    <Form.Input
                      fluid
                      onChange={(e, d) => {
                        this.setState({
                          userSelfDetails: {
                            ...this.state.userSelfDetails,
                            first_name: d.value,
                          },
                        });
                      }}
                      label={this.props.t("settings.firstname")}
                      placeholder={this.props.t(
                        "settings.firstnameplaceholder"
                      )}
                      value={this.state.userSelfDetails.first_name}
                    />
                    <Form.Input
                      fluid
                      onChange={(e, d) => {
                        this.setState({
                          userSelfDetails: {
                            ...this.state.userSelfDetails,
                            last_name: d.value,
                          },
                        });
                      }}
                      label={this.props.t("settings.lastname")}
                      placeholder={this.props.t("settings.lastnameplaceholder")}
                      value={this.state.userSelfDetails.last_name}
                    />
                  </Form.Group>
                  <Form.Input
                    fluid
                    label={this.props.t("settings.email")}
                    placeholder={this.props.t("settings.emailplaceholder")}
                    value={this.state.userSelfDetails.email}
                    onChange={(e, d) => {
                      this.setState({
                        userSelfDetails: {
                          ...this.state.userSelfDetails,
                          email: d.value,
                        },
                      });
                    }}
                  />
                  <Dropdown
                    placeholder={this.props.t("settings.language")}
                    onChange={(e, { value }) =>
                      this.props.i18n.changeLanguage(value)
                    }
                    fluid
                    search
                    selection
                    value={window.localStorage.i18nextLng}
                    options={[
                      {
                        key: "gb",
                        value: "gb",
                        flag: "gb",
                        text: this.props.t("settings.english"),
                      },
                      {
                        key: "de",
                        value: "de",
                        flag: "de",
                        text: this.props.t("settings.german"),
                      },
                    ]}
                  />
                </Form>{" "}
                <div style={{ paddingTop: 10 }}>
                  <Button
                    size="small"
                    color="green"
                    floated="left"
                    onClick={() => {
                      const newUserData = this.state.userSelfDetails;
                      delete newUserData["scan_directory"];
                      delete newUserData["avatar"];
                      this.props.dispatch(updateUser(newUserData));
                    }}
                  >
                    <Trans i18nKey="settings.updateaccountinformation">
                      Update profile settings
                    </Trans>
                  </Button>
                  <Button size="small" basic floated="right">
                    <Trans i18nKey="settings.cancel">Cancel</Trans>
                  </Button>
                </div>
              </Grid.Column>
            </Grid.Row>

            <Grid.Row>
              <Grid.Column width={4} textAlign="left">
                <b>
                  <Trans i18nKey="settings.scandirectory">Scan Directory</Trans>
                </b>
              </Grid.Column>

              <Grid.Column width={12}>
                <Input
                  type="text"
                  action
                  fluid
                  disabled
                  placeholder={this.state.userSelfDetails.scan_directory}
                >
                  <input />
                  <Popup
                    inverted
                    trigger={
                      <Button type="submit">
                        <Trans i18nKey="settings.change">Change</Trans>
                      </Button>
                    }
                    content="Only admin can change this."
                  />
                </Input>
              </Grid.Column>
            </Grid.Row>
          </Grid>
        </div>
        <Divider />
        <Header as="h3">Nextcloud</Header>
        <Grid>
          <Grid.Row>
            <Grid.Column width={4} textAlign="left">
              <b>Credentials</b>
              <Popup
                position="right center"
                inverted
                trigger={<Icon size="small" name="question" />}
                content="Use application password"
              />
            </Grid.Column>

            <Grid.Column width={12}>
              <Form>
                <Form.Group widths="equal">
                  <Form.Input
                    fluid
                    onChange={(e, d) => {
                      this.setState({
                        userSelfDetails: {
                          ...this.state.userSelfDetails,
                          nextcloud_server_address: d.value,
                        },
                      });
                    }}
                    label="Server address"
                    placeholder="https://..."
                  >
                    <input
                      value={
                        this.state.userSelfDetails.nextcloud_server_address
                      }
                    />
                  </Form.Input>
                  <Form.Input
                    fluid
                    onChange={(e, d) => {
                      this.setState({
                        userSelfDetails: {
                          ...this.state.userSelfDetails,
                          nextcloud_username: d.value,
                        },
                      });
                    }}
                    label="User name"
                    placeholder="User name"
                  >
                    <input
                      value={this.state.userSelfDetails.nextcloud_username}
                    />
                  </Form.Input>
                  <Form.Input
                    fluid
                    onChange={(e, d) => {
                      this.setState({
                        userSelfDetails: {
                          ...this.state.userSelfDetails,
                          nextcloud_app_password: d.value,
                        },
                      });
                    }}
                    type="password"
                    label="Nextcloud App Password"
                    placeholder="Nextcloud App Password"
                  />
                </Form.Group>
              </Form>{" "}
              <div>
                <Button
                  disabled={!this.state.userSelfDetails.nextcloud_app_password}
                  onClick={() => {
                    const ud = this.state.userSelfDetails;
                    delete ud["scan_directory"];
                    delete ud["avatar"];
                    this.props.dispatch(updateUser(ud));
                  }}
                  size="small"
                  color="blue"
                  floated="left"
                >
                  Update Nextcloud credentials
                </Button>
                <Button
                  onClick={() => {
                    this.setState({
                      userSelfDetails: this.props.userSelfDetails,
                    });
                  }}
                  size="small"
                  basic
                  floated="right"
                >
                  Cancel
                </Button>
              </div>
            </Grid.Column>
          </Grid.Row>
          <Grid.Row>
            <Grid.Column width={4} textAlign="left">
              <b>Nextcloud Scan Directory</b>
              <Popup
                trigger={
                  <Icon
                    size="small"
                    name="circle"
                    color={
                      this.props.fetchedNextcloudDirectoryTree ? "green" : "red"
                    }
                  />
                }
                inverted
                position="right center"
                content={
                  this.props.fetchedNextcloudDirectoryTree
                    ? "Logged into Nextcloud"
                    : "Not logged into Nextcloud"
                }
              />
            </Grid.Column>

            <Grid.Column width={12}>
              <Input
                type="text"
                action
                fluid
                disabled
                value={this.props.userSelfDetails.nextcloud_scan_directory}
              >
                <input
                  value={this.state.userSelfDetails.nextcloud_scan_directory}
                />
                <Button
                  disabled={!this.props.fetchedNextcloudDirectoryTree}
                  onClick={() => {
                    this.setState({ modalNextcloudScanDirectoryOpen: true });
                  }}
                  type="submit"
                >
                  Change
                </Button>
              </Input>
            </Grid.Column>
          </Grid.Row>
        </Grid>
        <Divider />
        <Header as="h3">Appearance</Header>
        <Grid>
          <Grid.Row>
            <Grid.Column width={4} textAlign="left">
              <b>Thumbnail size</b>
            </Grid.Column>

            <Grid.Column width={12}>
              <Form>
                <Form.Group>
                  <Form.Field>
                    <Radio
                      label="Big"
                      name="radioGroup"
                      value="loose"
                      onClick={() => {
                        this.setState({
                          userSelfDetails: {
                            ...this.state.userSelfDetails,
                            image_scale: 1,
                          },
                        });
                      }}
                      checked={this.state.userSelfDetails.image_scale === 1}
                    />
                  </Form.Field>
                  <Form.Field>
                    <Radio
                      label="Small"
                      name="radioGroup"
                      value="dense"
                      onClick={() => {
                        this.setState({
                          userSelfDetails: {
                            ...this.state.userSelfDetails,
                            image_scale: 2,
                          },
                        });
                      }}
                      checked={this.state.userSelfDetails.image_scale === 2}
                    />
                  </Form.Field>
                </Form.Group>
              </Form>
            </Grid.Column>
          </Grid.Row>
        </Grid>
        <Divider />
        <Header as="h3">Library</Header>
        <CountStats />
        <Divider hidden />
        <Grid stackable>
          <Grid.Row columns={4}>
            <Grid.Column>
              <Segment>
                <Header textAlign="center">
                  {this.props.util.countStats.num_photos} Photos
                </Header>
                <Divider />
                <Button
                  attached="top"
                  fluid
                  color="green"
                  onClick={this.onPhotoScanButtonClick}
                  disabled={buttonsDisabled}
                >
                  <Icon
                    name="refresh"
                    loading={
                      this.props.statusPhotoScan.status &&
                      this.props.statusPhotoScan.added
                    }
                  />
                  {this.props.statusPhotoScan.added
                    ? "Scanning photos (file system)" +
                      `(${this.props.statusPhotoScan.added}/${this.props.statusPhotoScan.to_add})`
                    : "Scan photos (file system)"}
                </Button>

                <Button
                  attached="bottom"
                  fluid
                  onClick={() => {
                    this.props.dispatch(scanNextcloudPhotos());
                  }}
                  disabled={
                    !this.props.fetchedNextcloudDirectoryTree ||
                    buttonsDisabled ||
                    !this.props.userSelfDetails.nextcloud_scan_directory
                  }
                  color="blue"
                >
                  <Icon name="refresh" />
                  Scan photos (Nextcloud)
                </Button>

                <Divider hidden />
                <List bulleted>
                  <List.Item>
                    Make a list of all files in subdirectories. For each media
                    file:
                  </List.Item>
                  <List.Item>
                    If the filepath exists, check if the file has been modified.
                    If it was modified, rescan the image. If not, we skip.
                  </List.Item>
                  <List.Item>
                    Calculate a unique ID of the image file (md5)
                  </List.Item>
                  <List.Item>
                    If this media file is already in the database, we add the
                    path to the existing media file.
                  </List.Item>
                  <List.Item>Generate a number of thumbnails </List.Item>
                  <List.Item>Generate image captions </List.Item>
                  <List.Item>Extract Exif information </List.Item>
                  <List.Item>
                    Reverse geolocate to get location names from GPS coordinates{" "}
                  </List.Item>
                  <List.Item>Extract faces. </List.Item>
                  <List.Item>Add photo to thing and place albums. </List.Item>
                  <List.Item>
                    Check if photos are missing or have been moved.{" "}
                  </List.Item>
                </List>
                <Button
                  fluid
                  color="green"
                  onClick={this.onPhotoFullScanButtonClick}
                  disabled={buttonsDisabled}
                >
                  <Icon
                    name="refresh"
                    loading={
                      this.props.statusPhotoScan.status &&
                      this.props.statusPhotoScan.added
                    }
                  />
                  {this.props.statusPhotoScan.added
                    ? "Rescan all photos (file system)" +
                      `(${this.props.statusPhotoScan.added}/${this.props.statusPhotoScan.to_add})`
                    : "Rescan all photos (file system)"}
                </Button>
              </Segment>
            </Grid.Column>
            <Grid.Column>
              <Segment>
                <Header textAlign="center">
                  {this.props.util.countStats.num_missing_photos} Missing Photos
                </Header>
                <Divider />
                <Button
                  fluid
                  attached={this.state.accordionTwoActive ? "bottom" : false}
                  onClick={this.open}
                  disabled={false && buttonsDisabled}
                  color="red"
                >
                  <Icon name="trash" />
                  Remove missing photos
                </Button>
                <Confirm
                  open={this.state.open}
                  onCancel={this.close}
                  onConfirm={this.onDeleteMissingPhotosButtonClick}
                />
                <Divider hidden />
                <p>
                  On every scan LibrePhotos will check if the files are still in
                  the same location or if they have been moved. If they are
                  missing, then they get marked as such.
                </p>
                <Divider />
              </Segment>
            </Grid.Column>
            <Grid.Column>
              <Segment>
                <Header textAlign="center">
                  {this.props.util.countStats.num_albumauto} Event Albums
                </Header>
                <Divider />
                <Button
                  fluid
                  attached={this.state.accordionTwoActive ? "bottom" : false}
                  onClick={this.onGenerateEventAlbumsButtonClick}
                  disabled={false && buttonsDisabled}
                  color="green"
                >
                  <Icon name="wizard" />
                  Generate Event Albums
                </Button>
                <Divider hidden />
                <p>
                  The backend server will first group photos by time taken. If
                  two consecutive photos are taken within 12 hours of each
                  other, the two photos are considered to be from the same
                  event. After groups are put together in this way, it
                  automatically generates a title for this album.
                </p>
                <Divider />
                <Button
                  attached={this.state.accordionThreeActive ? "bottom" : false}
                  onClick={() => {
                    this.props.dispatch(generateEventAlbumTitles());
                  }}
                  indicating="true"
                  disabled={false && buttonsDisabled}
                  color="green"
                  fluid
                >
                  <Icon name="wizard" />
                  Regenerate Event Titles
                </Button>
                <Divider hidden />
                <p>
                  Automatically generated albums have names of people in the
                  titles. If you trained your face classifier after making event
                  albums, you can generate new titles for already existing event
                  albums to reflect the new names associated with the faces in
                  photos.
                </p>
              </Segment>
            </Grid.Column>
            <Grid.Column>
              <Segment>
                <Header textAlign="center">
                  {this.props.util.countStats.num_faces} Faces,{" "}
                  {this.props.util.countStats.num_people} People
                </Header>
                <Divider />
                <Button
                  onClick={() => {
                    this.props.dispatch(trainFaces());
                  }}
                  fluid
                  color="green"
                >
                  <Icon name="lightning" /> Train Faces
                </Button>
                <Divider hidden />

                <Table celled>
                  <Table.Body>
                    <Table.Row>
                      <Table.Cell>
                        <b>
                          <Icon name="lightning" />
                          Inferred
                        </b>
                      </Table.Cell>
                      <Table.Cell textAlign="center">
                        {this.props.util.countStats.num_inferred_faces} faces
                      </Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell>
                        <b>
                          <Icon name="tag" />
                          Labeled
                        </b>
                      </Table.Cell>
                      <Table.Cell textAlign="center">
                        {this.props.util.countStats.num_labeled_faces} faces
                      </Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell>
                        <b>
                          <Icon name="question" />
                          Unknown
                        </b>
                      </Table.Cell>
                      <Table.Cell textAlign="center">
                        {this.props.util.countStats.num_unknown_faces} faces
                      </Table.Cell>
                    </Table.Row>
                  </Table.Body>
                </Table>
                <Divider hidden />
                <Button fluid as={Link} to="/faces">
                  <Icon name="share" />
                  Face Dashboard
                </Button>
                <Divider hidden />
                <Button
                  fluid
                  color="green"
                  onClick={() => {
                    this.props.dispatch(rescanFaces());
                  }}
                >
                  <Icon name="lightning" />
                  Rescan Faces
                </Button>
              </Segment>
            </Grid.Column>
          </Grid.Row>
        </Grid>
        <Divider />
        <Header as="h3">Scan Options</Header>
        <Grid>
          <Grid.Row>
            <Grid.Column width={4} textAlign="left">
              <b>Scene Confidence</b>
            </Grid.Column>
            <Grid.Column width={12}>
              <select
                value={this.state.userSelfDetails.confidence}
                onChange={(event) => {
                  this.setState({
                    userSelfDetails: {
                      ...this.state.userSelfDetails,
                      confidence: event.target.value,
                    },
                  });
                }}
              >
                <option value="" disabled selected>
                  Confidence Level
                </option>
                <option value="0.5">High</option>
                <option value="0.1">Standard</option>
                <option value="0.05">Low</option>
                <option value="0">None</option>
              </select>
            </Grid.Column>
          </Grid.Row>
          <Grid.Row>
            <Grid.Column width={4} textAlign="left">
              <b>Semantic Search Max Results</b>
            </Grid.Column>
            <Grid.Column width={12}>
              <select
                value={this.state.userSelfDetails.semantic_search_topk}
                onChange={(event) => {
                  this.setState({
                    userSelfDetails: {
                      ...this.state.userSelfDetails,
                      semantic_search_topk: event.target.value,
                    },
                  });
                }}
              >
                <option value="" disabled selected>
                  Semantic Search Results
                </option>
                <option value="100">Top 100</option>
                <option value="50">Top 50</option>
                <option value="10">Top 10</option>
                <option value="0">Disabled</option>
              </select>
            </Grid.Column>
          </Grid.Row>
          <Grid.Row>
            <Grid.Column width={12}>
              <Button
                type="submit"
                color="green"
                onClick={() => {
                  const newUserData = this.state.userSelfDetails;
                  delete newUserData["scan_directory"];
                  delete newUserData["avatar"];
                  this.props.dispatch(updateUser(newUserData));
                  if (typeof this.props.onRequestClose == "function")
                    this.props.onRequestClose();
                }}
              >
                Update
              </Button>
            </Grid.Column>
          </Grid.Row>
        </Grid>
        <Header as="h3">Favorite options</Header>
        <Grid>
          <Grid.Row>
            <Grid.Column width={4} textAlign="left">
              <b>Minimum image rating to interpret as favorite</b>
            </Grid.Column>
            <Grid.Column width={12}>
              <select
                value={this.state.userSelfDetails.favorite_min_rating}
                onChange={(event) => {
                  this.setState({
                    userSelfDetails: {
                      ...this.state.userSelfDetails,
                      favorite_min_rating: parseInt(event.target.value),
                    },
                  });
                }}
              >
                <option value="" disabled selected>
                  Minimum rating
                </option>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
                <option value={5}>5</option>
              </select>
            </Grid.Column>
          </Grid.Row>
          <Grid.Row>
            <Grid.Column width={4} textAlign="left">
              <b>Synchronize rating to disk</b>
            </Grid.Column>
            <Grid.Column width={12}>
              <select
                value={this.state.userSelfDetails.save_metadata_to_disk}
                onChange={(event) => {
                  this.setState(
                    {
                      userSelfDetails: {
                        ...this.state.userSelfDetails,
                        save_metadata_to_disk: event.target.value,
                      },
                    },
                    () => {
                      console.log(this.state.userSelfDetails);
                    }
                  );
                }}
              >
                <option value="" disabled selected />
                <option value={"OFF"}>Off</option>
                <option value={"SIDECAR_FILE"}>Save to sidecar</option>
                <option value={"MEDIA_FILE"}>Save to media file</option>
              </select>
            </Grid.Column>
          </Grid.Row>
          <Grid.Row>
            <Grid.Column width={12}>
              <Button
                type="submit"
                color="green"
                onClick={() => {
                  const newUserData = this.state.userSelfDetails;
                  delete newUserData["scan_directory"];
                  delete newUserData["avatar"];
                  this.props.dispatch(updateUser(newUserData));
                  if (typeof this.props.onRequestClose == "function")
                    this.props.onRequestClose();
                }}
              >
                Update
              </Button>
            </Grid.Column>
          </Grid.Row>
        </Grid>
        <Header as="h3">Experimental options</Header>
        <Grid>
          <Grid.Row>
            <Grid.Column width={4} textAlign="left">
              <b>Always trancode videos</b>
            </Grid.Column>
            <Grid.Column width={12}>
              <select
                value={this.state.userSelfDetails.transcode_videos}
                onChange={(event) => {
                  this.setState({
                    userSelfDetails: {
                      ...this.state.userSelfDetails,
                      transcode_videos: event.target.value,
                    },
                  });
                }}
              >
                <option value={false}>off</option>
                <option value={true}>on</option>
              </select>
            </Grid.Column>
          </Grid.Row>
          <Grid.Row>
            <Grid.Column width={12}>
              <Button
                type="submit"
                color="green"
                onClick={() => {
                  const newUserData = this.state.userSelfDetails;
                  delete newUserData["scan_directory"];
                  delete newUserData["avatar"];
                  this.props.dispatch(updateUser(newUserData));
                  if (typeof this.props.onRequestClose == "function")
                    this.props.onRequestClose();
                }}
              >
                Update
              </Button>
            </Grid.Column>
          </Grid.Row>
        </Grid>
        <ModalNextcloudScanDirectoryEdit
          onRequestClose={() => {
            this.setState({ modalNextcloudScanDirectoryOpen: false });
          }}
          userToEdit={this.state.userSelfDetails}
          isOpen={this.state.modalNextcloudScanDirectoryOpen}
        />
      </div>
    );
  }
}

const modalStyles = {
  content: {
    top: 50,
    left: 50,
    right: 50,
    height: window.innerHeight - 100,

    overflow: "hidden",
    padding: 0,
    backgroundColor: "white",
  },
  overlay: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    position: "fixed",
    borderRadius: 0,
    border: 0,
    zIndex: 102,
    backgroundColor: "rgba(200,200,200,0.8)",
  },
};

class ModalNextcloudScanDirectoryEdit extends Component {
  constructor(props) {
    super(props);
    this.state = { newScanDirectory: "", treeData: [] };
    this.nodeClicked = this.nodeClicked.bind(this);
    this.inputRef = React.createRef();
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    if (prevState.treeData.length === 0) {
      return { ...prevState, treeData: nextProps.nextcloudDirectoryTree };
    } else {
      return prevState;
    }
  }

  nodeClicked(event, rowInfo) {
    this.inputRef.current.inputRef.value = rowInfo.node.absolute_path;
    this.setState({ newScanDirectory: rowInfo.node.absolute_path });
  }

  render() {
    return (
      <Modal
        ariaHideApp={false}
        isOpen={this.props.isOpen}
        onRequestClose={() => {
          this.props.onRequestClose();
          this.setState({ newScanDirectory: "" });
        }}
        style={modalStyles}
        onAfterOpen={() => {
          this.props.dispatch(fetchNextcloudDirectoryTree("/"));
        }}
      >
        <div style={{ padding: 10 }}>
          <Header as="h3">Set your Nextcloud scan directory</Header>
        </div>
        <div style={{ padding: 10 }}>
          <Header as="h5">Current Nextcloud scan directory</Header>
        </div>
        <div style={{ padding: 7 }}>
          <Input
            ref={this.inputRef}
            type="text"
            placeholder={
              this.props.userToEdit
                ? this.props.userToEdit.nextcloud_scan_directory === ""
                  ? "not set"
                  : this.props.userToEdit.nextcloud_scan_directory
                : "..."
            }
            action
            fluid
          >
            <input value={this.state.newScanDirectory} />
            <Button
              type="submit"
              color="green"
              onClick={() => {
                const newUserData = {
                  ...this.props.userToEdit,
                  nextcloud_scan_directory: this.state.newScanDirectory,
                };
                const ud = newUserData;
                this.props.dispatch(updateUser(ud));
                this.props.onRequestClose();
              }}
            >
              Update
            </Button>
            <Button
              onClick={() => {
                this.props.onRequestClose();
              }}
            >
              Cancel
            </Button>
          </Input>
        </div>
        <Divider />
        <div style={{ paddingLeft: 10 }}>
          <Header as="h5">Choose a directory from below</Header>
        </div>
        <div
          style={{
            height: window.innerHeight - 100 - 40.44 - 36 - 52 - 30 - 10,
            width: "100%",
            paddingLeft: 7,
            paddingTop: 7,
            paddingBottom: 7,
          }}
        >
          <SortableTree
            innerStyle={{ outline: "none" }}
            canDrag={() => false}
            canDrop={() => false}
            treeData={this.state.treeData}
            onChange={(treeData) => this.setState({ treeData })}
            theme={FileExplorerTheme}
            generateNodeProps={(rowInfo) => {
              let nodeProps = {
                onClick: (event) => this.nodeClicked(event, rowInfo),
              };
              if (this.state.selectedNodeId === rowInfo.node.id) {
                nodeProps.className = "selected-node";
              }
              return nodeProps;
            }}
          />
        </div>
      </Modal>
    );
  }
}

ModalNextcloudScanDirectoryEdit = connect((store) => {
  return {
    auth: store.auth,

    nextcloudDirectoryTree: store.util.nextcloudDirectoryTree,
    fetchingNextcloudDirectoryTree: store.util.fetchingNextcloudDirectoryTree,
    fetchedNextcloudDirectoryTree: store.util.fetchedNextcloudDirectoryTree,

    userList: store.util.userList,
    fetchingUSerList: store.util.fetchingUserList,
    fetchedUserList: store.util.fetchedUserList,
  };
})(ModalNextcloudScanDirectoryEdit);

Settings = compose(
  connect((store) => {
    return {
      auth: store.auth,
      util: store.util,
      gridType: store.ui.gridType,
      siteSettings: store.util.siteSettings,
      statusPhotoScan: store.util.statusPhotoScan,
      statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
      generatingAutoAlbums: store.util.generatingAutoAlbums,
      scanningPhotos: store.photos.scanningPhotos,
      fetchedCountStats: store.util.fetchedCountStats,
      workerAvailability: store.util.workerAvailability,
      fetchedNextcloudDirectoryTree: store.util.fetchedNextcloudDirectoryTree,
      userSelfDetails: store.user.userSelfDetails,
    };
  }),
  withTranslation()
)(Settings);
