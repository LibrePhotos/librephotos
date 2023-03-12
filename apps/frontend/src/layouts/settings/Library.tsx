import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Collapse,
  Container,
  Dialog,
  Divider,
  Flex,
  Grid,
  Group,
  HoverCard,
  List,
  Loader,
  Modal,
  Space,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { showNotification } from "@mantine/notifications";
import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Book,
  BrandNextcloud,
  Check,
  FaceId,
  Folder,
  QuestionMark,
  Refresh,
  RefreshDot,
  X,
} from "tabler-icons-react";

import { scanAllPhotos, scanNextcloudPhotos, scanPhotos } from "../../actions/photosActions";
import {
  deleteMissingPhotos,
  fetchCountStats,
  generateEventAlbumTitles,
  generateEventAlbums,
  updateUser,
} from "../../actions/utilActions";
import { api, useWorkerQuery } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { useLazyFetchNextcloudDirsQuery } from "../../api_client/nextcloud";
import { ModalNextcloudScanDirectoryEdit } from "../../components/modals/ModalNextcloudScanDirectoryEdit";
import { CountStats } from "../../components/statistics";
import i18n from "../../i18n";
import { useAppDispatch, useAppSelector } from "../../store/store";

export function Library() {
  const [isOpen, { open, close }] = useDisclosure(false);
  const [nextcloudAuthStatusPopup, { close: closeNextcloudAuthStatusPopup, open: openNextcloudAuthStatusPopup }] =
    useDisclosure(false);
  const [credentialsPopup, { close: closeCredentialsPopup, open: openCredentialsPopup }] = useDisclosure(false);
  const [isOpenUpdateDialog, setIsOpenUpdateDialog] = useState(false);
  const [isOpenNextcloudHelp, setIsOpenNextcloudHelp] = useState(false);
  const [avatarImgSrc, setAvatarImgSrc] = useState("/unknown_user.jpg");
  const [userSelfDetails, setUserSelfDetails] = useState({} as any);
  const [modalNextcloudScanDirectoryOpen, setModalNextcloudScanDirectoryOpen] = useState(false);
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const userSelfDetailsRedux = useAppSelector(state => state.user.userSelfDetails);
  const { data: worker } = useWorkerQuery();
  const [workerAvailability, setWorkerAvailability] = useState(false);
  const util = useAppSelector(state => state.util);
  const statusPhotoScan = useAppSelector(state => state.util.statusPhotoScan);
  const { t } = useTranslation();
  const [fetchNextcloudDirs, { isFetching: isNextcloudFetching }] = useLazyFetchNextcloudDirsQuery();

  const onPhotoScanButtonClick = () => {
    dispatch(scanPhotos());
  };

  const onPhotoFullScanButtonClick = () => {
    dispatch(scanAllPhotos());
  };

  const onGenerateEventAlbumsButtonClick = () => {
    dispatch(generateEventAlbums());
  };

  const onDeleteMissingPhotosButtonClick = () => {
    dispatch(deleteMissingPhotos());
    close();
  };

  // open update dialog, when user was edited
  useEffect(() => {
    if (JSON.stringify(userSelfDetailsRedux) !== JSON.stringify(userSelfDetails)) {
      setIsOpenUpdateDialog(true);
    } else {
      setIsOpenUpdateDialog(false);
    }
  }, [userSelfDetailsRedux, userSelfDetails]);

  useEffect(() => {
    dispatch(fetchCountStats());
    dispatch(api.endpoints.fetchUserSelfDetails.initiate(auth.access.user_id));
    fetchNextcloudDirs(undefined, true);
  }, [auth.access.user_id, dispatch, fetchNextcloudDirs]);

  useEffect(() => {
    setUserSelfDetails(userSelfDetailsRedux);
  }, [userSelfDetailsRedux]);

  useEffect(() => {
    if (worker) {
      setWorkerAvailability(worker.queue_can_accept_job);
    }
  }, [worker]);

  if (avatarImgSrc === "/unknown_user.jpg") {
    if (userSelfDetails.avatar_url) {
      setAvatarImgSrc(serverAddress + userSelfDetails.avatar_url);
    }
  }

  return (
    <Container>
      <Flex align="baseline" justify="space-between">
        <Group spacing="xs" sx={{ marginBottom: 20, marginTop: 40 }}>
          <Book size={35} />
          <Title order={1}>{t("settings.library")}</Title>
        </Group>
      </Flex>

      <Stack>
        <CountStats />
        <Card shadow="md">
          <Stack>
            <Title order={4} sx={{ marginBottom: 16 }}>
              <Trans i18nKey="settings.photos">Photos</Trans>
              {+util.countStats.num_missing_photos > 0 && (
                <HoverCard width={280} shadow="md">
                  <HoverCard.Target>
                    <Badge onClick={open} color="red" sx={{ marginLeft: 10 }}>
                      {+util.countStats.num_missing_photos}{" "}
                      <Trans i18nKey="settings.missingphotos">Missing photos</Trans>
                    </Badge>
                  </HoverCard.Target>
                  <HoverCard.Dropdown>
                    <Text size="sm">
                      <Trans i18nKey="settings.missingphotosdescription"></Trans>
                    </Text>
                  </HoverCard.Dropdown>
                </HoverCard>
              )}
              <Modal opened={isOpen} title={t("settings.missingphotosbutton")} onClose={close}>
                <Stack spacing="xl">
                  This action will delete all missing photos and it&apos;s metadata from the database.
                  <Group>
                    <Button onClick={close}>Cancel</Button>
                    <Button color="red" onClick={onDeleteMissingPhotosButtonClick}>
                      Confirm
                    </Button>
                  </Group>
                </Stack>
              </Modal>
            </Title>
            <Grid>
              <Grid.Col span={10}>
                <Stack spacing={0}>
                  <Text>Scan Library</Text>
                  <Text fz="sm" color="dimmed">
                    {t("settings.scanphotosdescription")}
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={2}>
                <Button
                  onClick={onPhotoScanButtonClick}
                  disabled={!workerAvailability}
                  leftIcon={<Refresh />}
                  variant="subtle"
                >
                  {statusPhotoScan.status && statusPhotoScan.added ? <Loader /> : null}
                  {statusPhotoScan.added
                    ? `${t("settings.statusscanphotostrue")}(${statusPhotoScan.added}/${statusPhotoScan.to_add})`
                    : t("settings.statusscanphotosfalse")}
                </Button>
              </Grid.Col>
            </Grid>
            <Divider />
            <Grid>
              <Grid.Col span={10}>
                <Stack spacing={0}>
                  <Group>
                    <Text>Force local library rescan</Text>
                    <ActionIcon radius="xl" variant="light" size="xs">
                      <QuestionMark onClick={() => setIsOpenNextcloudHelp(!isOpenNextcloudHelp)} />
                    </ActionIcon>
                  </Group>
                  <Text fz="sm" color="dimmed">
                    {t("settings.rescanphotosdescription")}
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={2}>
                <Button
                  onClick={onPhotoFullScanButtonClick}
                  disabled={!workerAvailability}
                  leftIcon={<Refresh />}
                  variant="subtle"
                >
                  {statusPhotoScan.status && statusPhotoScan.added ? <Loader /> : null}
                  {statusPhotoScan.added
                    ? `${t("settings.statusrescanphotostrue")}(${statusPhotoScan.added}/${statusPhotoScan.to_add})`
                    : t("settings.statusrescanphotosfalse")}
                </Button>
              </Grid.Col>
            </Grid>

            <Collapse in={isOpenNextcloudHelp}>
              <List>
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
            </Collapse>
            <Divider
              labelProps={{ fw: "bold" }}
              labelPosition="left"
              label={t("settings.eventsalbums")}
              mt={20}
              mb={10}
            ></Divider>
            <Grid>
              <Grid.Col span={10}>
                <Stack spacing={0}>
                  <Text>{t("settings.eventalbumsgenerate")}</Text>
                  <Text fz="sm" color="dimmed">
                    {t("settings.eventsalbumsdescription")}
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={2}>
                <Button
                  onClick={onGenerateEventAlbumsButtonClick}
                  disabled={!workerAvailability}
                  leftIcon={<RefreshDot />}
                  variant="subtle"
                >
                  Generate
                </Button>
              </Grid.Col>
            </Grid>

            <Grid>
              <Grid.Col span={10}>
                <Stack spacing={0}>
                  <Text>{t("settings.eventalbumsregenerate")}</Text>
                  <Text fz="sm" color="dimmed">
                    {t("settings.eventalbumsregeneratedescription")}
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={2}>
                <Button
                  onClick={() => {
                    dispatch(generateEventAlbumTitles());
                  }}
                  disabled={!workerAvailability}
                  leftIcon={<RefreshDot />}
                  variant="subtle"
                >
                  Generate
                </Button>
              </Grid.Col>
            </Grid>
          </Stack>
          <Divider
            labelProps={{ fw: "bold" }}
            labelPosition="left"
            label={`${t("settings.faces")} & ${t("settings.people")}`}
            mt={20}
            mb={10}
          />
          <Grid>
            <Grid.Col span={10}>
              <Stack spacing={0}>
                <Text>{t("settings.trainfacestitle")}</Text>
                <Text fz="sm" color="dimmed">
                  {t("settings.trainfacesdescription")}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={2}>
              <Button
                disabled={!workerAvailability}
                onClick={() => {
                  dispatch(api.endpoints.trainFaces.initiate());
                  showNotification({
                    message: i18n.t<string>("toasts.trainingstarted"),
                    title: i18n.t<string>("toasts.trainingstartedtitle"),
                    color: "teal",
                  });
                }}
                leftIcon={<FaceId />}
                variant="subtle"
              >
                <Trans i18nKey="settings.facesbutton">Train Faces</Trans>
              </Button>
            </Grid.Col>
          </Grid>
          <Grid>
            <Grid.Col span={10}>
              <Stack spacing={0}>
                <Text>{t("settings.rescanfacestitle")}</Text>
                <Text fz="sm" color="dimmed">
                  {t("settings.rescanfacesdescription")}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={2}>
              <Button
                disabled={!workerAvailability}
                onClick={() => {
                  dispatch(api.endpoints.rescanFaces.initiate());
                  showNotification({
                    message: i18n.t<string>("toasts.rescanfaces"),
                    title: i18n.t<string>("toasts.rescanfacestitle"),
                    color: "teal",
                  });
                }}
                leftIcon={<FaceId />}
                variant="subtle"
              >
                <Trans i18nKey="settings.rescanfaces">Rescan</Trans>
              </Button>
            </Grid.Col>
          </Grid>
          <Divider labelProps={{ fw: "bold" }} labelPosition="left" label="Nextcloud" mt={20} mb={10} />
          <Grid>
            <Grid.Col span={10}>
              <Stack spacing={0}>
                <Text>Status</Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={2}>
              <Button
                size="xs"
                leftIcon={isNextcloudFetching ? <Check /> : <X />}
                variant="subtle"
                color={isNextcloudFetching ? "green" : "red"}
              >
                {isNextcloudFetching ? t("settings.nextcloudloggedin") : t("settings.nextcloudnotloggedin")}
              </Button>
            </Grid.Col>
            <Grid.Col span={7}>
              <Stack spacing={0}>
                <Trans i18nKey="settings.serveradress" />
              </Stack>
            </Grid.Col>
            <Grid.Col span={5}>
              <TextInput
                onChange={event => {
                  setUserSelfDetails({ ...userSelfDetails, nextcloud_server_address: event.currentTarget.value });
                }}
                value={userSelfDetails.nextcloud_server_address}
                placeholder={t("settings.serveradressplaceholder")}
              />
            </Grid.Col>
            <Grid.Col span={7}>
              <Stack spacing={0}>
                <Trans i18nKey="settings.nextcloudusername" />
              </Stack>
            </Grid.Col>
            <Grid.Col span={5}>
              <TextInput
                onChange={event => {
                  setUserSelfDetails({ ...userSelfDetails, nextcloud_username: event.currentTarget.value });
                }}
                value={userSelfDetails.nextcloud_username}
                placeholder={t("settings.nextcloudusernameplaceholder")}
              />
            </Grid.Col>
            <Grid.Col span={7}>
              <Stack spacing={0}>
                <Trans i18nKey="settings.nextcloudpassword" />

                <Text size="sm" color="dimmed">
                  {t("settings.credentialspopup")}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={5}>
              <TextInput
                onChange={event => {
                  setUserSelfDetails({ ...userSelfDetails, nextcloud_app_password: event.currentTarget.value });
                }}
                type="password"
                placeholder={t("settings.nextcloudpasswordplaceholder")}
                value={userSelfDetails.nextcloud_app_password}
              />
            </Grid.Col>
            <Grid.Col span={10}>
              <Stack spacing={0}>
                <Trans i18nKey="settings.nextcloudscandirectory" />

                <Text size="sm" color="dimmed">
                  Pick the folder to process from the nextcloud instance
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={2}>
              <Button
                leftIcon={<Folder />}
                disabled={isNextcloudFetching}
                onClick={() => {
                  setModalNextcloudScanDirectoryOpen(true);
                }}
                variant="subtle"
              >
                {userSelfDetails.nextcloud_scan_directory
                  ? userSelfDetails.nextcloud_scan_directory
                  : t("modalnextcloud.notset")}
              </Button>
            </Grid.Col>
            <Grid.Col span={10}></Grid.Col>
            <Grid.Col span={2}>
              <Button
                onClick={() => {
                  dispatch(scanNextcloudPhotos());
                }}
                disabled={isNextcloudFetching || !workerAvailability || !userSelfDetails.nextcloud_scan_directory}
                variant="subtle"
                leftIcon={<BrandNextcloud />}
              >
                <Trans i18nKey="settings.scannextcloudphotos">Scan photos (Nextcloud)</Trans>
              </Button>
            </Grid.Col>
          </Grid>

          <Group mt={20}></Group>
          <Space h="xl" />
          <ModalNextcloudScanDirectoryEdit
            path={userSelfDetails.nextcloud_scan_directory}
            isOpen={modalNextcloudScanDirectoryOpen}
            onChange={path =>
              setUserSelfDetails({
                ...userSelfDetails,
                nextcloud_scan_directory: path,
              })
            }
            onClose={() => {
              setModalNextcloudScanDirectoryOpen(false);
            }}
          />
        </Card>

        <Dialog
          opened={isOpenUpdateDialog}
          withCloseButton
          onClose={() => setIsOpenUpdateDialog(false)}
          size="lg"
          radius="md"
        >
          <Text size="sm" style={{ marginBottom: 10 }} weight={500}>
            Save Changes?
          </Text>

          <Group align="flex-end">
            <Button
              size="sm"
              color="green"
              onClick={() => {
                const newUserData = userSelfDetails;
                delete newUserData.scan_directory;
                delete newUserData.avatar;
                updateUser(newUserData, dispatch);
                dispatch(api.endpoints.fetchUserSelfDetails.initiate(auth.access.user_id));
                setIsOpenUpdateDialog(false);
              }}
            >
              <Trans i18nKey="settings.favoriteupdate">Update profile settings</Trans>
            </Button>
            <Button
              onClick={() => {
                setUserSelfDetails(userSelfDetails);
              }}
              size="sm"
            >
              <Trans i18nKey="settings.nextcloudcancel">Cancel</Trans>
            </Button>
          </Group>
        </Dialog>
      </Stack>
      <Space h="xl" />
    </Container>
  );
}
