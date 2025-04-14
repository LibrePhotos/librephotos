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
  useComputedColorScheme,
  useMantineTheme,
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

import { useGenerateAutoAlbumsMutation } from "../../api_client/jobs/hooks";
import { useTrainFacesMutation } from "../../api_client/faces";
import { serverAddress } from "../../api_client/apiClient";
import { useFetchNextcloudDirsQuery } from "../../api_client/folders/hooks/useFetchNextcloudDirsQuery";
import { useDeleteMissingPhotosMutation  } from "../../api_client/photos/hooks";
import { useUpdateUserMutation } from "../../api_client/user/hooks";
import { useFetchCountStatsQuery } from "../../api_client/stats/hooks";
import { COUNT_STATS_DEFAULTS } from "../../api_client/stats/types";
import { ModalNextcloudScanDirectoryEdit } from "../../components/modals/ModalNextcloudScanDirectoryEdit";
import { CountStats } from "../../components/statistics";
import { notification } from "../../service/notifications";
import { User } from "../../api_client/user/types";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { fetchClient } from "../../api_client/api";
import { useRescanPhotosMutation, useScanNextcloudPhotosMutation, useScanPhotosMutation, useWorkerQuery } from "../../api_client/jobs/hooks";

function BadgeIcon(details: User, isSuccess: boolean, isError: boolean, isFetching: boolean) {
  const { nextcloud_server_address: server } = details;
  if (isSuccess && server) {
    return <Check size={20} />;
  }
  if (isError) {
    return <X size={20} />;
  }
  if (isFetching) {
    return <RefreshDot size={20} />;
  }
  return <QuestionMark size={20} />;
}

export function Library() {
  const [isOpen, { open, close }] = useDisclosure(false);
  const [isOpenUpdateDialog, setIsOpenUpdateDialog] = useState(false);
  const [isOpenNextcloudHelp, setIsOpenNextcloudHelp] = useState(false);
  const [avatarImgSrc, setAvatarImgSrc] = useState("/unknown_user.jpg");
  const [modalNextcloudScanDirectoryOpen, setModalNextcloudScanDirectoryOpen] = useState(false);
  const { data: userSelfDetails } = useCurrentUserSelfDetailsQuery();
  const [editedUser, setEditedUser] = useState({} as User);
  const { data: worker } = useWorkerQuery();
  const [workerAvailability, setWorkerAvailability] = useState(false);
  const { t } = useTranslation();
  const { data: nextcloudDirs, isFetching: isNextcloudFetching, isSuccess: isNextcloudSuccess, isError: isNextcloudError } = useFetchNextcloudDirsQuery();
  const [nextcloudStatusColor, setNextcloudStatusColor] = useState("gray");
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();
  const { mutate: generateAutoAlbums } = useGenerateAutoAlbumsMutation();
  const { data: countStats = COUNT_STATS_DEFAULTS } = useFetchCountStatsQuery();
  const updateUser = useUpdateUserMutation();
  const scanPhotos = useScanPhotosMutation();
  const rescanPhotos = useRescanPhotosMutation();
  const scanNextcloudPhotos = useScanNextcloudPhotosMutation();
  const deleteMissingPhotos = useDeleteMissingPhotosMutation();
  const trainFaces = useTrainFacesMutation();

  const onGenerateEventAlbumsButtonClick = () => {  
    generateAutoAlbums();
  };

  const onDeleteMissingPhotosButtonClick = () => {
    deleteMissingPhotos.mutate();
    close();
  };

  // open update dialog, when user was edited
  useEffect(() => {
    if (JSON.stringify(editedUser) !== JSON.stringify(userSelfDetails)) {
      setIsOpenUpdateDialog(true);
    } else {
      setIsOpenUpdateDialog(false);
    }
  }, [editedUser, userSelfDetails]);

  useEffect(() => {
    setEditedUser(userSelfDetails);
  }, [userSelfDetails]);

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
        <Group gap="xs" mt={{ base: 20, sm: 40 }} mb={{ base: 10, sm: 20 }}>
          <Book size={35} />
          <Title order={1}>{t("settings.library")}</Title>
        </Group>
      </Flex>

      <Stack>
        <CountStats />
        <Card shadow="md">
          <Stack>
            <Title order={4} mb={16}>
              <Trans i18nKey="settings.photos">Photos</Trans>
              {countStats.num_missing_photos > 0 && (
                <HoverCard width={280} shadow="md">
                  <HoverCard.Target>
                    <Badge onClick={open} color="red" ml={10}>
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
                <Stack gap="xl">
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
              <Grid.Col span={{ base: 12, sm: 10 }}>
                <Stack gap={0}>
                  <Group>
                    <Text>Scan Library</Text>
                    <ActionIcon radius="xl" variant="light" size="xs">
                      <QuestionMark onClick={() => setIsOpenNextcloudHelp(!isOpenNextcloudHelp)} />
                    </ActionIcon>
                  </Group>
                  <Text fz="sm" c="dimmed">
                    {t("settings.scanphotosdescription")}
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 2 }}>
                <Group wrap="nowrap" gap={0} justify="flex-end">
                  <Button
                    onClick={() => scanPhotos.mutate()}
                    disabled={!workerAvailability}
                    leftSection={<Refresh />}
                    variant="filled"
                    style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                    fullWidth
                  >
                    {(t("settings.statusscanphotosfalse"))}
                  </Button>
                  <Menu transitionProps={{ transition: "pop" }} position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon
                        variant="filled"
                        color="blue"
                        size={36}
                        style={{
                          borderTopLeftRadius: 0,
                          borderBottomLeftRadius: 0,
                          border: 0,
                          borderLeft:
                            colorScheme === "dark" ? `1px solid ${theme.colors.dark[7]}` : `1px solid ${theme.white}`,
                        }}
                      >
                        <ChevronDown size="1rem" />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item 
                        leftSection={<Refresh size="1rem" />} 
                        onClick={() => rescanPhotos.mutate()}
                        disabled={!workerAvailability}
                      >
                        {t("settings.statusrescanphotosfalse")}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Grid.Col>
            </Grid>

            <Collapse in={isOpenNextcloudHelp}>
              <Stack gap={0}>
                <Text>Rescan will reprocess your entire library through the following tasks:</Text>
                <List>
                  <List.Item>
                    <Text fz="sm" c="dimmed">
                      <Trans i18nKey="settings.scannextclouddescription.item1">
                        Make a list of all files in subdirectories. For each media file:
                      </Trans>
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text fz="sm" c="dimmed">
                      <Trans i18nKey="settings.scannextclouddescription.item2">
                        If the filepath exists, check if the file has been modified. If it was modified, rescan the
                        image. If not, we skip.
                      </Trans>
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text fz="sm" c="dimmed">
                      <Trans i18nKey="settings.scannextclouddescription.item3">
                        Calculate a unique ID of the image file (md5)
                      </Trans>
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text fz="sm" c="dimmed">
                      <Trans i18nKey="settings.scannextclouddescription.item4">
                        If this media file is already in the database, we add the path to the existing media file.
                      </Trans>
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text fz="sm" c="dimmed">
                      <Trans i18nKey="settings.scannextclouddescription.item5">Generate a number of thumbnails</Trans>
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text fz="sm" c="dimmed">
                      <Trans i18nKey="settings.scannextclouddescription.item6">Generate image captions</Trans>
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text fz="sm" c="dimmed">
                      <Trans i18nKey="settings.scannextclouddescription.item7">Extract Exif information</Trans>
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text fz="sm" c="dimmed">
                      <Trans i18nKey="settings.scannextclouddescription.item8">
                        Reverse geolocate to get location names from GPS coordinates
                      </Trans>
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text fz="sm" c="dimmed">
                      <Trans i18nKey="settings.scannextclouddescription.item9">Extract faces.</Trans>
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text fz="sm" c="dimmed">
                      <Trans i18nKey="settings.scannextclouddescription.item10">
                        Add photo to thing and place albums.
                      </Trans>
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text fz="sm" c="dimmed">
                      <Trans i18nKey="settings.scannextclouddescription.item11">
                        Check if photos are missing or have been moved.
                      </Trans>
                    </Text>
                  </List.Item>
                </List>
              </Stack>
            </Collapse>
            <Divider labelPosition="left" label={<Text fw="bold">{t("settings.eventsalbums")}</Text>} mt={20} mb={10} />
            <Grid>
              <Grid.Col span={{ base: 12, sm: 10 }}>
                <Stack gap={0}>
                  <Text>{t("settings.eventalbumsgenerate")}</Text>
                  <Text fz="sm" c="dimmed">
                    {t("settings.eventsalbumsdescription")}
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 2 }}>
                <Button
                  onClick={onGenerateEventAlbumsButtonClick}
                  disabled={!workerAvailability}
                  leftSection={<RefreshDot />}
                  variant="outline"
                  fullWidth
                >
                  Generate
                </Button>
              </Grid.Col>
            </Grid>

            <Grid>
              <Grid.Col span={{ base: 12, sm: 10 }}>
                <Stack gap={0}>
                  <Text>{t("settings.eventalbumsregenerate")}</Text>
                  <Text fz="sm" c="dimmed">
                    {t("settings.eventalbumsregeneratedescription")}
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 2 }}>
                <Button
                  onClick={() => {
                    generateAutoAlbums();
                    notification.regenerateEventAlbums();
                  }}
                  disabled={!workerAvailability}
                  leftSection={<RefreshDot />}
                  variant="outline"
                  fullWidth
                >
                  Generate
                </Button>
              </Grid.Col>
            </Grid>
          </Stack>
          <Divider
            labelPosition="left"
            label={
              <Text fw="bold">
                {t("settings.faces")} & {t("settings.people")}
              </Text>
            }
            mt={20}
            mb={10}
          />
          <Grid>
            <Grid.Col span={{ base: 12, sm: 10 }}>
              <Stack gap={0}>
                <Text>{t("settings.trainfacestitle")}</Text>
                <Text fz="sm" c="dimmed">
                  {t("settings.trainfacesdescription")}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 2 }}>
              <Button
                disabled={!workerAvailability}
                onClick={() => {
                  trainFaces.mutate();
                  notification.trainFaces();
                }}
                leftSection={<FaceId />}
                variant="outline"
                fullWidth
              >
                <Trans i18nKey="settings.facesbutton">Train Faces</Trans>
              </Button>
            </Grid.Col>
          </Grid>
          <Grid>
            <Grid.Col span={{ base: 12, sm: 10 }}>
              <Stack gap={0}>
                <Text>{t("settings.rescanfacestitle")}</Text>
                <Text fz="sm" c="dimmed">
                  {t("settings.rescanfacesdescription")}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 2 }}>
              <Button
                disabled={!workerAvailability}
                onClick={() => {
                  fetchClient.get("/scanfaces");

                  notification.rescanFaces();
                }}
                leftSection={<FaceId />}
                variant="outline"
                fullWidth
              >
                <Trans i18nKey="settings.rescanfaces">Rescan</Trans>
              </Button>
            </Grid.Col>
          </Grid>
          <Divider labelPosition="left" label={<Text fw="bold">Nextcloud</Text>} mt={20} mb={10} />
          <Grid>
            <Grid.Col span={{ base: 12, sm: 10 }}>
              <Stack gap={0}>
                <Text>Status</Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 2 }}>
              <Badge
                leftSection={BadgeIcon(userSelfDetails, isNextcloudSuccess, isNextcloudError, isNextcloudFetching)}
                variant="outline"
                color={nextcloudStatusColor}
                fullWidth
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
            <Grid.Col span={{ base: 12, sm: 7 }}>
              <Stack gap={0}>
                <Trans i18nKey="settings.serveradress" />
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 5 }}>
              <TextInput
                onChange={event => {
                  setUserSelfDetails({ ...userSelfDetails, nextcloud_server_address: event.currentTarget.value });
                }}
                value={userSelfDetails.nextcloud_server_address}
                placeholder={t("settings.serveradressplaceholder")}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 7 }}>
              <Stack gap={0}>
                <Trans i18nKey="settings.nextcloudusername" />
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 5 }}>
              <TextInput
                onChange={event => {
                  setUserSelfDetails({ ...userSelfDetails, nextcloud_username: event.currentTarget.value });
                }}
                value={userSelfDetails.nextcloud_username}
                placeholder={t("settings.nextcloudusernameplaceholder")}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 7 }}>
              <Stack gap={0}>
                <Trans i18nKey="settings.nextcloudpassword" />
                <Text size="sm" c="dimmed">
                  {t("settings.credentialspopup")}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 5 }}>
              <TextInput
                onChange={event => {
                  setUserSelfDetails({ ...userSelfDetails, nextcloud_app_password: event.currentTarget.value });
                }}
                type="password"
                placeholder={t("settings.nextcloudpasswordplaceholder")}
                value={userSelfDetails.nextcloud_app_password}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 10 }}>
              <Stack gap={0}>
                <Trans i18nKey="settings.nextcloudscandirectory" />
                <Text size="sm" c="dimmed">
                  {userSelfDetails.nextcloud_scan_directory
                    ? userSelfDetails.nextcloud_scan_directory
                    : "Choose the folder to process from the nextcloud instance"}
                </Text>
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 2 }}>
              <Button
                leftSection={<Folder />}
                disabled={isNextcloudError || isNextcloudFetching || !userSelfDetails.nextcloud_server_address}
                onClick={() => {
                  setModalNextcloudScanDirectoryOpen(true);
                }}
                variant="outline"
                fullWidth
              >
                {t("modalnextcloud.browse")}
              </Button>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 10 }} />
            <Grid.Col span={{ base: 12, sm: 2 }}>
              <Button
                onClick={() => {
                  scanNextcloudPhotos.mutate();
                }}
                disabled={isNextcloudFetching || !workerAvailability || !userSelfDetails.nextcloud_server_address}
                variant="filled"
                leftSection={<BrandNextcloud />}
                fullWidth
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
          <Text size="sm" style={{ marginBottom: 10 }} fw={500}>
            Save Changes?
          </Text>

          <Group justify="flex-end">
            <Button
              size="sm"
              color="green"
              onClick={() => {
                const newUserData = userSelfDetails;
                delete newUserData.scan_directory;
                delete newUserData.avatar;
                updateUser.mutate(newUserData);
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
