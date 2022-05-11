import MaterialIcon from "material-icons-react";
import React, { useEffect, useRef, useState } from "react";
import AvatarEditor from "react-avatar-editor";
import Dropzone, { DropzoneRef } from "react-dropzone";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Button,
  Confirm,
  Divider,
  Dropdown,
  Form,
  Grid,
  Header,
  Icon,
  Input,
  List,
  Popup,
  Radio,
  Segment,
  Table,
} from "semantic-ui-react";

import { rescanFaces, trainFaces } from "../../actions/facesActions";
import { scanAllPhotos, scanNextcloudPhotos, scanPhotos } from "../../actions/photosActions";
import {
  deleteMissingPhotos,
  fetchCountStats,
  fetchJobList,
  fetchNextcloudDirectoryTree,
  fetchSiteSettings,
  generateEventAlbumTitles,
  generateEventAlbums,
  updateAvatar,
  updateUser,
} from "../../actions/utilActions";
import { api } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { ModalNextcloudScanDirectoryEdit } from "../../components/modals/ModalNextcloudScanDirectoryEdit";
import { ConfigDatetime } from "../../components/settings/ConfigDatetime";
import { CountStats } from "../../components/statistics";
import { useAppDispatch, useAppSelector } from "../../store/store";

export const Settings = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [avatarImgSrc, setAvatarImgSrc] = useState("/unknown_user.jpg");
  const [userSelfDetails, setUserSelfDetails] = useState({} as any);
  const [modalNextcloudScanDirectoryOpen, setModalNextcloudScanDirectoryOpen] = useState(false);
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const userSelfDetailsRedux = useAppSelector(state => state.user.userSelfDetails);
  const workerAvailability = useAppSelector(state => state.util.workerAvailability);
  const fetchedNextcloudDirectoryTree = useAppSelector(state => state.util.fetchedNextcloudDirectoryTree);
  const util = useAppSelector(state => state.util);
  const statusPhotoScan = useAppSelector(state => state.util.statusPhotoScan);
  const { t, i18n } = useTranslation();

  let editor = useRef(null);

  const open = () => setIsOpen(true);

  const close = () => setIsOpen(false);

  const setEditorRef = newEditor => (editor = newEditor);

  let dropzoneRef = React.useRef<DropzoneRef>();

  const onPhotoScanButtonClick = e => {
    dispatch(scanPhotos());
  };

  const onPhotoFullScanButtonClick = e => {
    dispatch(scanAllPhotos());
  };

  const onGenerateEventAlbumsButtonClick = e => {
    dispatch(generateEventAlbums());
  };

  const onDeleteMissingPhotosButtonClick = e => {
    dispatch(deleteMissingPhotos());
    close();
  };

  const urltoFile = (url, filename, mimeType) => {
    mimeType = mimeType || (url.match(/^data:([^;]+);/) || "")[1];
    return fetch(url)
      .then(res => res.arrayBuffer())
      .then(buf => new File([buf], filename, { type: mimeType }));
  };

  useEffect(() => {
    dispatch(fetchCountStats());
    fetchSiteSettings(dispatch);
    dispatch(api.endpoints.fetchUserSelfDetails.initiate(auth.access.user_id));
    dispatch(fetchNextcloudDirectoryTree("/"));
    if (auth.access.is_admin) {
      dispatch(fetchJobList());
    }
  }, []);

  useEffect(() => {
    setUserSelfDetails(userSelfDetailsRedux);
  }, [userSelfDetailsRedux]);
  let buttonsDisabled = !workerAvailability;
  buttonsDisabled = false;
  if (avatarImgSrc === "/unknown_user.jpg") {
    if (userSelfDetails.avatar_url) {
      setAvatarImgSrc(serverAddress + userSelfDetails.avatar_url);
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
                  noClick
                  //@ts-ignore
                  style={{ width: 150, height: 150, borderRadius: 75 }}
                  ref={node => {
                    //@ts-ignore
                    dropzoneRef = node;
                  }}
                  onDrop={(accepted, rejected) => {
                    setAvatarImgSrc(URL.createObjectURL(accepted[0]));
                  }}
                >
                  {({ getRootProps, getInputProps }) => (
                    <div {...getRootProps()}>
                      <input {...getInputProps()} />
                      <AvatarEditor ref={setEditorRef} width={150} height={150} border={0} image={avatarImgSrc} />
                    </div>
                  )}
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
                    <Trans i18nKey="settings.uploadheader">Upload new avatar</Trans>
                  </b>
                </p>
                <Button
                  size="small"
                  onClick={() => {
                    //@ts-ignore
                    dropzoneRef.open();
                  }}
                >
                  <Icon name="image" />
                  <Trans i18nKey="settings.image">Choose image</Trans>
                </Button>
                <Button
                  size="small"
                  color="green"
                  onClick={() => {
                    const form_data = new FormData();
                    // @ts-ignore
                    urltoFile(
                      // @ts-ignore
                      editor.getImageScaledToCanvas().toDataURL(),
                      `${userSelfDetails.first_name}avatar.png`
                    ).then(file => {
                      form_data.append("avatar", file, `${userSelfDetails.first_name}avatar.png`);
                      dispatch(updateAvatar(userSelfDetails, form_data));
                    });
                  }}
                >
                  <Icon name="upload" />
                  <Trans i18nKey="settings.upload">Upload</Trans>
                </Button>
                <p>
                  <Trans i18nKey="settings.filesize">The maximum file size allowed is 200KB.</Trans>
                </p>
              </div>
            </Grid.Column>
          </Grid.Row>

          <Grid.Row>
            <Grid.Column width={4} textAlign="left">
              <b>
                <Trans i18nKey="settings.accountinformation">Account Information</Trans>
              </b>
            </Grid.Column>

            <Grid.Column width={12}>
              <Form>
                <Form.Group widths="equal">
                  <Form.Input
                    fluid
                    onChange={(e, d) => {
                      setUserSelfDetails({ ...userSelfDetails, first_name: d.value });
                    }}
                    label={t("settings.firstname")}
                    placeholder={t("settings.firstnameplaceholder")}
                    value={userSelfDetails.first_name}
                  />
                  <Form.Input
                    fluid
                    onChange={(e, d) => {
                      setUserSelfDetails({ ...userSelfDetails, last_name: d.value });
                    }}
                    label={t("settings.lastname")}
                    placeholder={t("settings.lastnameplaceholder")}
                    value={userSelfDetails.last_name}
                  />
                </Form.Group>
                <Form.Input
                  fluid
                  label={t("settings.email")}
                  placeholder={t("settings.emailplaceholder")}
                  value={userSelfDetails.email}
                  onChange={(e, d) => {
                    setUserSelfDetails({ ...userSelfDetails, email: d.value });
                  }}
                />
                <Dropdown
                  placeholder={t("settings.language")}
                  // @ts-ignore
                  onChange={(e, { value }) => i18n.changeLanguage(value)}
                  fluid
                  search
                  selection
                  value={window.localStorage.i18nextLng}
                  options={[
                    {
                      key: "gb",
                      value: "gb",
                      flag: "gb",
                      text: t("settings.english"),
                    },
                    {
                      key: "de",
                      value: "de",
                      flag: "de",
                      text: t("settings.german"),
                    },
                    {
                      key: "es",
                      value: "es",
                      flag: "es",
                      text: t("settings.spanish"),
                    },
                    {
                      key: "fr",
                      value: "fr",
                      flag: "fr",
                      text: t("settings.french"),
                    },
                    {
                      key: "it",
                      value: "it",
                      flag: "it",
                      text: t("settings.italian"),
                    },
                    {
                      key: "nb_NO",
                      value: "nb_NO",
                      flag: "no",
                      text: t("settings.norwegianbokmal"),
                    },
                    {
                      key: "zh_Hans",
                      value: "zh_Hans",
                      flag: "cn",
                      text: t("settings.simplifiedchinese"),
                    },
                    {
                      key: "ru",
                      value: "ru",
                      flag: "ru",
                      text: t("settings.russian"),
                    },
                    {
                      key: "ja",
                      value: "ja",
                      flag: "jp",
                      text: t("settings.japanese"),
                    },
                    {
                      key: "sv",
                      value: "sv",
                      flag: "se",
                      text: t("settings.swedish"),
                    },
                    {
                      key: "pl",
                      value: "pl",
                      flag: "pl",
                      text: t("settings.polish"),
                    },
                    {
                      key: "nl",
                      value: "nl",
                      flag: "nl",
                      text: t("settings.dutch"),
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
                    const newUserData = userSelfDetails;
                    delete newUserData.scan_directory;
                    delete newUserData.avatar;
                    updateUser(newUserData, dispatch);
                  }}
                >
                  <Trans i18nKey="settings.updateaccountinformation">Update profile settings</Trans>
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
              <Input type="text" action fluid disabled placeholder={userSelfDetails.scan_directory}>
                <input />
                <Popup
                  inverted
                  trigger={
                    <Button type="submit">
                      <Trans i18nKey="settings.change">Change</Trans>
                    </Button>
                  }
                  content="Only admin can change "
                />
              </Input>
            </Grid.Column>
          </Grid.Row>
        </Grid>
      </div>
      <Divider />
      <Header as="h3">
        <Trans i18nKey="settings.nextcloudheader">Nextcloud</Trans>
      </Header>
      <Grid>
        <Grid.Row>
          <Grid.Column width={4} textAlign="left">
            <b>
              <Trans i18nKey="settings.credentials">Credentials</Trans>
            </b>
            <Popup
              position="right center"
              inverted
              trigger={<Icon size="small" name="question" />}
              content={t("settings.credentialspopup")}
            />
          </Grid.Column>

          <Grid.Column width={12}>
            <Form>
              <Form.Group widths="equal">
                <Form.Input
                  fluid
                  onChange={(e, d) => {
                    setUserSelfDetails({ ...userSelfDetails, nextcloud_server_address: d.value });
                  }}
                  label={t("settings.serveradress")}
                  placeholder={t("settings.serveradressplaceholder")}
                >
                  <input value={userSelfDetails.nextcloud_server_address} />
                </Form.Input>
                <Form.Input
                  fluid
                  onChange={(e, d) => {
                    setUserSelfDetails({ ...userSelfDetails, nextcloud_username: d.value });
                  }}
                  label={t("settings.nextcloudusername")}
                  placeholder={t("settings.nextcloudusernameplaceholder")}
                >
                  <input value={userSelfDetails.nextcloud_username} />
                </Form.Input>
                <Form.Input
                  fluid
                  onChange={(e, d) => {
                    setUserSelfDetails({ ...userSelfDetails, nextcloud_app_password: d.value });
                  }}
                  type="password"
                  label={t("settings.nextcloudpassword")}
                  placeholder={t("settings.nextcloudpasswordplaceholder")}
                />
              </Form.Group>
            </Form>{" "}
            <div>
              <Button
                disabled={!userSelfDetails.nextcloud_app_password}
                onClick={() => {
                  const ud = userSelfDetails;
                  delete ud.scan_directory;
                  delete ud.avatar;
                  updateUser(ud, dispatch);
                }}
                size="small"
                color="blue"
                floated="left"
              >
                <Trans i18nKey="settings.nextcloudupdate">Update Nextcloud credentials</Trans>
              </Button>
              <Button
                onClick={() => {
                  setUserSelfDetails(userSelfDetails);
                }}
                size="small"
                basic
                floated="right"
              >
                <Trans i18nKey="settings.nextcloudcancel">Cancel</Trans>
              </Button>
            </div>
          </Grid.Column>
        </Grid.Row>
        <Grid.Row>
          <Grid.Column width={4} textAlign="left">
            <b>
              <Trans i18nKey="settings.nextcloudscandirectory">Nextcloud Scan Directory</Trans>
            </b>
            <Popup
              trigger={<Icon size="small" name="circle" color={fetchedNextcloudDirectoryTree ? "green" : "red"} />}
              inverted
              position="right center"
              content={
                fetchedNextcloudDirectoryTree ? t("settings.nextcloudloggedin") : t("settings.nextcloudnotloggedin")
              }
            />
          </Grid.Column>

          <Grid.Column width={12}>
            <Input type="text" action fluid disabled value={userSelfDetails.nextcloud_scan_directory}>
              <input value={userSelfDetails.nextcloud_scan_directory} />
              <Button
                disabled={!fetchedNextcloudDirectoryTree}
                onClick={() => {
                  setModalNextcloudScanDirectoryOpen(true);
                }}
                type="submit"
              >
                <Trans i18nKey="settings.nextcloudchange">Change</Trans>
              </Button>
            </Input>
          </Grid.Column>
        </Grid.Row>
      </Grid>
      <Divider />
      <Header as="h3">
        <Trans i18nKey="settings.appearance">Appearance</Trans>
      </Header>
      <Grid>
        <Grid.Row>
          <Grid.Column width={4} textAlign="left">
            <b>
              <Trans i18nKey="settings.thumbnailsize">Thumbnail size</Trans>
            </b>
          </Grid.Column>

          <Grid.Column width={12}>
            <Form>
              <Form.Group>
                <Form.Field>
                  <Radio
                    label={t("settings.big")}
                    name="radioGroup"
                    value="loose"
                    onClick={() => {
                      setUserSelfDetails({ ...userSelfDetails, image_scale: 1 });
                    }}
                    checked={userSelfDetails.image_scale === 1}
                  />
                </Form.Field>
                <Form.Field>
                  <Radio
                    label={t("settings.small")}
                    name="radioGroup"
                    value="dense"
                    onClick={() => {
                      setUserSelfDetails({ ...userSelfDetails, image_scale: 2 });
                    }}
                    checked={userSelfDetails.image_scale === 2}
                  />
                </Form.Field>
              </Form.Group>
            </Form>
          </Grid.Column>
        </Grid.Row>
      </Grid>
      <Divider />
      <Header as="h3">
        <Trans i18nKey="settings.library">Library</Trans>
      </Header>
      <CountStats />
      <Divider hidden />
      <Grid stackable>
        <Grid.Row columns={4}>
          <Grid.Column>
            <Segment>
              <Header textAlign="center">
                {util.countStats.num_photos} <Trans i18nKey="settings.photos">Photos</Trans>
              </Header>
              <Divider />
              <Button attached="top" fluid color="green" onClick={onPhotoScanButtonClick} disabled={buttonsDisabled}>
                <Icon name="refresh" loading={statusPhotoScan.status && statusPhotoScan.added} />
                {statusPhotoScan.added
                  ? `${t("settings.statusscanphotostrue")}(${statusPhotoScan.added}/${statusPhotoScan.to_add})`
                  : t("settings.statusscanphotosfalse")}
              </Button>

              <Button
                attached="bottom"
                fluid
                onClick={() => {
                  dispatch(scanNextcloudPhotos());
                }}
                disabled={
                  !fetchedNextcloudDirectoryTree || buttonsDisabled || !userSelfDetails.nextcloud_scan_directory
                }
                color="blue"
              >
                <Icon name="refresh" />
                <Trans i18nKey="settings.scannextcloudphotos">Scan photos (Nextcloud)</Trans>
              </Button>

              <Divider hidden />
              <List bulleted>
                <List.Item>
                  <Trans i18nKey="settings.scannextclouddescription.item1">
                    Make a list of all files in subdirectories. For each media file:
                  </Trans>
                </List.Item>
                <List.Item>
                  <Trans i18nKey="settings.scannextclouddescription.item2">
                    If the filepath exists, check if the file has been modified. If it was modified, rescan the image.
                    If not, we skip.
                  </Trans>
                </List.Item>
                <List.Item>
                  <Trans i18nKey="settings.scannextclouddescription.item3">
                    Calculate a unique ID of the image file (md5)
                  </Trans>
                </List.Item>
                <List.Item>
                  <Trans i18nKey="settings.scannextclouddescription.item4">
                    If this media file is already in the database, we add the path to the existing media file.
                  </Trans>
                </List.Item>
                <List.Item>
                  <Trans i18nKey="settings.scannextclouddescription.item5">Generate a number of thumbnails</Trans>{" "}
                </List.Item>
                <List.Item>
                  <Trans i18nKey="settings.scannextclouddescription.item6">Generate image captions</Trans>{" "}
                </List.Item>
                <List.Item>
                  <Trans i18nKey="settings.scannextclouddescription.item7">Extract Exif information</Trans>{" "}
                </List.Item>
                <List.Item>
                  <Trans i18nKey="settings.scannextclouddescription.item8">
                    Reverse geolocate to get location names from GPS coordinates{" "}
                  </Trans>
                </List.Item>
                <List.Item>
                  <Trans i18nKey="settings.scannextclouddescription.item9">Extract faces. </Trans>{" "}
                </List.Item>
                <List.Item>
                  <Trans i18nKey="settings.scannextclouddescription.item10">Add photo to thing and place albums.</Trans>{" "}
                </List.Item>
                <List.Item>
                  <Trans i18nKey="settings.scannextclouddescription.item11">
                    Check if photos are missing or have been moved.
                  </Trans>
                </List.Item>
              </List>
              <Button fluid color="green" onClick={onPhotoFullScanButtonClick} disabled={buttonsDisabled}>
                <Icon name="refresh" loading={statusPhotoScan.status && statusPhotoScan.added} />
                {statusPhotoScan.added
                  ? `${t("settings.statusrescanphotostrue")}(${statusPhotoScan.added}/${statusPhotoScan.to_add})`
                  : t("settings.statusrescanphotosfalse")}
              </Button>
            </Segment>
          </Grid.Column>
          <Grid.Column>
            <Segment>
              <Header textAlign="center">
                {util.countStats.num_missing_photos} <Trans i18nKey="settings.missingphotos">Missing Photos</Trans>
              </Header>
              <Divider />
              <Button fluid attached={false} onClick={open} disabled={false && buttonsDisabled} color="red">
                <Icon name="trash" />
                <Trans i18nKey="settings.missingphotosbutton">Remove missing photos</Trans>
              </Button>
              <Confirm open={isOpen} onCancel={close} onConfirm={onDeleteMissingPhotosButtonClick} />
              <Divider hidden />
              <p>
                <Trans i18nKey="settings.missingphotosdescription">
                  On every scan LibrePhotos will check if the files are still in the same location or if they have been
                  moved. If they are missing, then they get marked as such.
                </Trans>
              </p>
              <Divider />
            </Segment>
          </Grid.Column>
          <Grid.Column>
            <Segment>
              <Header textAlign="center">
                {util.countStats.num_albumauto} <Trans i18nKey="settings.eventsalbums">Event Albums</Trans>
              </Header>
              <Divider />
              <Button
                fluid
                attached={false}
                onClick={onGenerateEventAlbumsButtonClick}
                disabled={false && buttonsDisabled}
                color="green"
              >
                <Icon name="wizard" />
                <Trans i18nKey="settings.eventalbumsgenerate">Generate Event Albums</Trans>
              </Button>
              <Divider hidden />
              <p>
                <Trans i18nKey="settings.eventsalbumsdescription">
                  The backend server will first group photos by time taken. If two consecutive photos are taken within
                  12 hours of each other, the two photos are considered to be from the same event. After groups are put
                  together in this way, it automatically generates a title for this album.
                </Trans>
              </p>
              <Divider />
              <Button
                attached={false}
                onClick={() => {
                  dispatch(generateEventAlbumTitles());
                }}
                indicating="true"
                disabled={false && buttonsDisabled}
                color="green"
                fluid
              >
                <Icon name="wizard" />
                <Trans i18nKey="settings.eventalbumsregenerate">Regenerate Event Titles</Trans>
              </Button>
              <Divider hidden />
              <p>
                <Trans i18nKey="settings.eventalbumsregeneratedescription">
                  Automatically generated albums have names of people in the titles. If you trained your face classifier
                  after making event albums, you can generate new titles for already existing event albums to reflect
                  the new names associated with the faces in photos.
                </Trans>
              </p>
            </Segment>
          </Grid.Column>
          <Grid.Column>
            <Segment>
              <Header textAlign="center">
                {util.countStats.num_faces} <Trans i18nKey="settings.faces">Faces</Trans>, {util.countStats.num_people}{" "}
                <Trans i18nKey="settings.people">People</Trans>
              </Header>
              <Divider />
              <Button
                onClick={() => {
                  dispatch(trainFaces());
                }}
                fluid
                color="green"
              >
                <Icon name="lightning" /> <Trans i18nKey="settings.facesbutton">Train Faces</Trans>
              </Button>
              <Divider hidden />

              <Table celled>
                <Table.Body>
                  <Table.Row>
                    <Table.Cell>
                      <b>
                        <Icon name="lightning" />
                        <Trans i18nKey="settings.inferred">Inferred</Trans>
                      </b>
                    </Table.Cell>
                    <Table.Cell textAlign="center">
                      {util.countStats.num_inferred_faces} <Trans i18nKey="settings.facessmall">faces</Trans>
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row>
                    <Table.Cell>
                      <b>
                        <Icon name="tag" />
                        <Trans i18nKey="settings.labeled">Labeled</Trans>
                      </b>
                    </Table.Cell>
                    <Table.Cell textAlign="center">
                      {util.countStats.num_labeled_faces} <Trans i18nKey="settings.facessmall">faces</Trans>
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row>
                    <Table.Cell>
                      <b>
                        <Icon name="question" />
                        <Trans i18nKey="settings.unknown">Unknown</Trans>
                      </b>
                    </Table.Cell>
                    <Table.Cell textAlign="center">
                      {util.countStats.num_unknown_faces} <Trans i18nKey="settings.facessmall">faces</Trans>
                    </Table.Cell>
                  </Table.Row>
                </Table.Body>
              </Table>
              <Divider hidden />
              <Button fluid as={Link} to="/faces">
                <Icon name="share" />
                <Trans i18nKey="settings.facedashboard">Face Dashboard</Trans>
              </Button>
              <Divider hidden />
              <Button
                fluid
                color="green"
                onClick={() => {
                  dispatch(rescanFaces());
                }}
              >
                <Icon name="lightning" />
                <Trans i18nKey="settings.rescanfaces">Rescan Faces</Trans>
              </Button>
            </Segment>
          </Grid.Column>
        </Grid.Row>
      </Grid>
      <Divider />
      <Header as="h3">
        <Trans i18nKey="settings.scanoptions">Scan Options</Trans>
      </Header>
      <Grid>
        <Grid.Row>
          <Grid.Column width={4} textAlign="left">
            <b>
              <Trans i18nKey="settings.sceneconfidence">Scene Confidence</Trans>
            </b>
          </Grid.Column>
          <Grid.Column width={12}>
            <select
              value={userSelfDetails.confidence}
              onChange={event => {
                setUserSelfDetails({ ...userSelfDetails, confidence: event.target.value });
              }}
            >
              <option value="" disabled selected>
                {t("settings.confidencelevel")}
              </option>
              <option value="0.5">{t("settings.confidence.high")}</option>
              <option value="0.1">{t("settings.confidence.standard")}</option>
              <option value="0.05">{t("settings.confidence.low")}</option>
              <option value="0">{t("settings.confidence.none")}</option>
            </select>
          </Grid.Column>
        </Grid.Row>
        <Grid.Row>
          <Grid.Column width={4} textAlign="left">
            <b>
              {" "}
              <Trans i18nKey="settings.semanticsearchheader">Semantic Search Max Results</Trans>
            </b>
          </Grid.Column>
          <Grid.Column width={12}>
            <select
              value={userSelfDetails.semantic_search_topk}
              onChange={event => {
                setUserSelfDetails({ ...userSelfDetails, semantic_search_topk: event.target.value });
              }}
            >
              <option value="" disabled selected>
                {t("settings.semanticsearch.placeholder")}
              </option>
              <option value="100">{t("settings.semanticsearch.top100")}</option>
              <option value="50">{t("settings.semanticsearch.top50")}</option>
              <option value="10">{t("settings.semanticsearch.top10")}</option>
              <option value="0">{t("settings.semanticsearch.top0")}</option>
            </select>
          </Grid.Column>
        </Grid.Row>
        <Grid.Row>
          <Grid.Column width={12}>
            <Button
              type="submit"
              color="green"
              onClick={() => {
                const newUserData = userSelfDetails;
                delete newUserData.scan_directory;
                delete newUserData.avatar;
                updateUser(newUserData, dispatch);
              }}
            >
              <Trans i18nKey="settings.semanticsearchupdate">Update</Trans>
            </Button>
          </Grid.Column>
        </Grid.Row>
      </Grid>
      <Header as="h3">
        <Trans i18nKey="settings.metadata">Metadata options</Trans>
      </Header>

      <Grid>
        <Grid.Row>
          <Grid.Column width={4} textAlign="left">
            <b>
              <Trans i18nKey="settings.sync">Synchronize metadata to disk</Trans>
            </b>
          </Grid.Column>
          <Grid.Column width={12}>
            <select
              value={userSelfDetails.save_metadata_to_disk}
              onChange={event => {
                setUserSelfDetails({ ...userSelfDetails, save_metadata_to_disk: event.target.value });
              }}
            >
              <option value="" disabled selected />
              <option value="OFF">{t("settings.favoritesyncoptions.off")}</option>
              <option value="SIDECAR_FILE">{t("settings.favoritesyncoptions.sidecar")}</option>
              <option value="MEDIA_FILE">{t("settings.favoritesyncoptions.mediafile")}</option>
            </select>
          </Grid.Column>
        </Grid.Row>
      </Grid>
      <Grid>
        <Grid.Row>
          <Grid.Column width={4} textAlign="left">
            <b>
              <Trans i18nKey="settings.favoriteminimum">Minimum image rating to interpret as favorite</Trans>
            </b>
          </Grid.Column>
          <Grid.Column width={12}>
            <select
              value={userSelfDetails.favorite_min_rating}
              onChange={event => {
                setUserSelfDetails({ ...userSelfDetails, favorite_min_rating: event.target.value });
              }}
            >
              <option value="" disabled selected>
                {t("settings.favoriteoption.placeholder")}
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
          <Grid.Column width={12}>
            <Button
              type="submit"
              color="green"
              onClick={() => {
                const newUserData = userSelfDetails;
                delete newUserData.scan_directory;
                delete newUserData.avatar;
                updateUser(newUserData, dispatch);
              }}
            >
              <Trans i18nKey="settings.favoriteupdate">Update</Trans>
            </Button>
          </Grid.Column>
        </Grid.Row>
      </Grid>
      <ConfigDatetime />
      <Header as="h3">
        <Trans i18nKey="settings.experimentaloptions">Experimental options</Trans>
      </Header>
      <Grid>
        <Grid.Row>
          <Grid.Column width={4} textAlign="left">
            <b>
              <Trans i18nKey="settings.transcodevideo">Always trancode videos</Trans>
            </b>
          </Grid.Column>
          <Grid.Column width={12}>
            <select
              value={userSelfDetails.transcode_videos}
              onChange={event => {
                setUserSelfDetails({ ...userSelfDetails, transcode_videos: event.target.value });
              }}
            >
              {
                //@ts-ignore
                <option value={false}>{t("settings.off")}</option>
              }
              {
                //@ts-ignore
                <option value>{t("settings.on")}</option>
              }
            </select>
          </Grid.Column>
        </Grid.Row>
        <Grid.Row>
          <Grid.Column width={12}>
            <Button
              type="submit"
              color="green"
              onClick={() => {
                const newUserData = userSelfDetails;
                delete newUserData.scan_directory;
                delete newUserData.avatar;
                updateUser(newUserData, dispatch);
              }}
            >
              <Trans i18nKey="settings.experimentalupdate">Update</Trans>
            </Button>
          </Grid.Column>
        </Grid.Row>
      </Grid>
      <ModalNextcloudScanDirectoryEdit
        onRequestClose={() => {
          setModalNextcloudScanDirectoryOpen(false);
        }}
        userToEdit={userSelfDetails}
        isOpen={modalNextcloudScanDirectoryOpen}
      />
    </div>
  );
};
