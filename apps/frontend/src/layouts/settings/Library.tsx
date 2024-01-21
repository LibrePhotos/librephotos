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
  Menu,
  Modal,
  Space,
  Stack,
  Text,
  TextInput,
  Title,
  createStyles,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBook as Book,
  IconBrandNextcloud as BrandNextcloud,
  IconCheck as Check,
  IconChevronDown as ChevronDown,
  IconFaceId as FaceId,
  IconFolder as Folder,
  IconQuestionMark as QuestionMark,
  IconRefresh as Refresh,
  IconRefreshDot as RefreshDot,
  IconX as X,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { scanAllPhotos, scanNextcloudPhotos, scanPhotos } from "../../actions/photosActions";
import { deleteMissingPhotos, generateEventAlbumTitles, updateUser } from "../../actions/utilActions";
import { useGenerateAutoAlbumsMutation } from "../../api_client/albums/auto";
import { api, useWorkerQuery } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { useLazyFetchNextcloudDirsQuery } from "../../api_client/nextcloud";
import { COUNT_STATS_DEFAULTS, useFetchCountStatsQuery } from "../../api_client/util";
import { ModalNextcloudScanDirectoryEdit } from "../../components/modals/ModalNextcloudScanDirectoryEdit";
import { CountStats } from "../../components/statistics";
import { notification } from "../../service/notifications";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { IUser } from "../../store/user/user.zod";

const useStyles = createStyles(theme => ({
  button: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },

  menuControl: {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    border: 0,
    borderLeft: `1px solid ${theme.colorScheme === "dark" ? theme.colors.dark[7] : theme.white}`,
  },
}));

function BadgeIcon(details: IUser, isSuccess: boolean, isError: boolean, isFetching: boolean) {
  const { nextcloud_server_address: server } = details;
  if (isSuccess && server) {
    return <Check />;
  }
  if (isError) {
    return <X />;
  }
  if (isFetching) {
    return <RefreshDot />;
  }
  return <QuestionMark />;
}

export function Library() {
  const [isOpen, { open, close }] = useDisclosure(false);
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
  const statusPhotoScan = useAppSelector(state => state.util.statusPhotoScan);
  const { t } = useTranslation();
  const [
    fetchNextcloudDirs,
    { isFetching: isNextcloudFetching, isSuccess: isNextcloudSuccess, isError: isNextcloudError },
  ] = useLazyFetchNextcloudDirsQuery();
  const [nextcloudStatusColor, setNextcloudStatusColor] = useState("gray");
  const { classes } = useStyles();
  const [generateAutoAlbums] = useGenerateAutoAlbumsMutation();
  const { data: countStats = COUNT_STATS_DEFAULTS } = useFetchCountStatsQuery();

  const onPhotoScanButtonClick = () => {
    dispatch(scanPhotos());
  };

  const onPhotoFullScanButtonClick = () => {
    dispatch(scanAllPhotos());
  };

  const onGenerateEventAlbumsButtonClick = () => {
    dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
    dispatch({
      type: "SET_WORKER_RUNNING_JOB",
      payload: { job_type_str: "Generate Event Albums" },
    });
    generateAutoAlbums();
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

  useEffect(() => {
    if (isNextcloudFetching === true) {
      setNextcloudStatusColor("blue");
    } else if (isNextcloudSuccess === true && userSelfDetails.nextcloud_server_address) {
      setNextcloudStatusColor("green");
    } else if (isNextcloudError === true) {
      setNextcloudStatusColor("red");
    }
  }, [isNextcloudFetching, isNextcloudSuccess, isNextcloudError]);

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
              {countStats.num_missing_photos > 0 && (
                <HoverCard width={280} shadow="md">
                  <HoverCard.Target>
                    <Badge onClick={open} color="red" sx={{ marginLeft: 10 }}>
                      {countStats.num_missing_photos} <Trans i18nKey="settings.missingphotos">Missing photos</Trans>
                    </Badge>
                  </HoverCard.Target>
                  <HoverCard.Dropdown>
                    <Text size="sm">
                      <Trans i18nKey="settings.missingphotosdescription" />
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
                  <Group>
                    <Text>Scan Library</Text>
                    <ActionIcon radius="xl" variant="light" size="xs">
                      <QuestionMark onClick={() => setIsOpenNextcloudHelp(!isOpenNextcloudHelp)} />
                    </ActionIcon>
                  </Group>
                  <Text fz="sm" color="dimmed">
                    {t("settings.scanphotosdescription")}
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={2}>
                <Group noWrap spacing={0}>
                  <Button
                    onClick={onPhotoScanButtonClick}
                    disabled={!workerAvailability}
                    leftIcon={<Refresh />}
                    variant="filled"
                    className={classes.button}
                  >
                    {statusPhotoScan.status && statusPhotoScan.added ? <Loader /> : null}
                    {statusPhotoScan.added
                      ? `${t("settings.statusscanphotostrue")}(${statusPhotoScan.added}/${statusPhotoScan.to_add})`
                      : t("settings.statusscanphotosfalse")}
                  </Button>
                  <Menu transitionProps={{ transition: "pop" }} position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="filled" color="blue" size={36} className={classes.menuControl}>
                        <ChevronDown size="1rem" />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item icon={<Refresh size="1rem" />} onClick={onPhotoFullScanButtonClick}>
                        {statusPhotoScan.status && statusPhotoScan.added ? <Loader /> : null}
                        {statusPhotoScan.added
                          ? `${t("settings.statusrescanphotostrue")}(${statusPhotoScan.added}/${
                              statusPhotoScan.to_add
                            })`
                          : t("settings.statusrescanphotosfalse")}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Grid.Col>
            </Grid>

            <Collapse in={isOpenNextcloudHelp}>
              <Text fz="lg">Rescan will reprocess your entire library through the following tasks: </Text>
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
            />
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
                  variant="outline"
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
                  variant="outline"
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
                  notification.trainFaces();
                }}
                leftIcon={<FaceId />}
                variant="outline"
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
                  notification.rescanFaces();
                }}
                leftIcon={<FaceId />}
                variant="outline"
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
              <Badge
                size="xs"
                p={10}
                style={{ marginLeft: -20 }}
                leftSection={BadgeIcon(userSelfDetails, isNextcloudSuccess, isNextcloudError, isNextcloudFetching)}
                variant="outline"
                color={nextcloudStatusColor}
              >
                {!userSelfDetails.nextcloud_server_address && t("settings.nextcloudsetup")}
                {isNextcloudFetching && t("settings.nextcloudconnecting")}
                {isNextcloudSuccess &&
                  userSelfDetails.nextcloud_server_address &&
                  !isNextcloudFetching &&
                  t("settings.nextcloudloggedin")}
                {isNextcloudError && t("settings.nextcloudnotloggedin")}
              </Badge>
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
                  {userSelfDetails.nextcloud_scan_directory
                    ? userSelfDetails.nextcloud_scan_directory
                    : "Choose the folder to process from the nextcloud instance"}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={2}>
              <Button
                leftIcon={<Folder />}
                disabled={isNextcloudError || isNextcloudFetching || !userSelfDetails.nextcloud_server_address}
                onClick={() => {
                  setModalNextcloudScanDirectoryOpen(true);
                }}
                variant="outline"
              >
                {t("modalnextcloud.browse")}
              </Button>
            </Grid.Col>
            <Grid.Col span={10} />
            <Grid.Col span={2}>
              <Button
                onClick={() => {
                  dispatch(scanNextcloudPhotos());
                }}
                disabled={isNextcloudFetching || !workerAvailability || !userSelfDetails.nextcloud_server_address}
                variant="filled"
                leftIcon={<BrandNextcloud />}
              >
                <Trans i18nKey="settings.scannextcloudphotos">Scan photos (Nextcloud)</Trans>
              </Button>
            </Grid.Col>
          </Grid>

          <Group mt={20} />
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
