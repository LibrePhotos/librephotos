import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Collapse,
  Container,
  Divider,
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
  IconTextRecognition as TextRecognition,
  IconX as X,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { fetchClient } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { useAccessToken } from "../../api_client/auth/hooks";
import { useTrainFacesMutation } from "../../api_client/faces";
import { useFetchNextcloudDirsQuery } from "../../api_client/folders/hooks/useFetchNextcloudDirsQuery";
import {
  useGenerateAutoAlbumsMutation,
  useGenerateOcrMutation,
  useRescanPhotosMutation,
  useScanNextcloudPhotosMutation,
  useScanPhotosMutation,
  useWorkerQuery,
} from "../../api_client/jobs/hooks";
import { useDeleteMissingPhotosMutation } from "../../api_client/photos/hooks";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useFetchCountStatsQuery } from "../../api_client/stats/hooks";
import { COUNT_STATS_DEFAULTS } from "../../api_client/stats/types";
import { useFetchUserListQuery, useUpdateUserMutation } from "../../api_client/user/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { User } from "../../api_client/user/types";
import { notification } from "../../service/notifications";
import { reportUserSaveError } from "../../util/apiErrors";
import { CountStats } from "../CountStats";
import { ModalNextcloudScanDirectoryEdit } from "../modals/ModalNextcloudScanDirectoryEdit";
import { ModalUserEdit } from "../modals/ModalUserEdit";
import { SaveChangesDialog } from "./SaveChangesDialog";

// The action buttons share one minimum width so they line up; longer translations still grow.
const ACTION_MIN_WIDTH = 160;

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
  const [isScanHelpOpen, setIsScanHelpOpen] = useState(false);
  const [avatarImgSrc, setAvatarImgSrc] = useState("/unknown_user.jpg");
  const [modalNextcloudScanDirectoryOpen, setModalNextcloudScanDirectoryOpen] = useState(false);
  const [scanDirectorySetupOpen, setScanDirectorySetupOpen] = useState(false);
  const { data: userSelfDetails } = useCurrentUserSelfDetailsQuery();
  const { data: auth } = useAccessToken();
  const { data: userList } = useFetchUserListQuery();
  const [editedUser, setEditedUser] = useState<User | null>(null);
  const { data: worker } = useWorkerQuery();
  const [workerAvailability, setWorkerAvailability] = useState(false);
  const { t } = useTranslation();
  const { data: siteSettings } = useGetSettingsQuery();
  const isNextcloudEnabled = siteSettings?.nextcloud_enabled ?? false;
  const ocrModel = siteSettings?.ocr_model ?? "none";
  const isOcrEnabled = ocrModel.trim().toLowerCase() !== "none";
  const {
    isFetching: isNextcloudFetching,
    isSuccess: isNextcloudSuccess,
    isError: isNextcloudError,
  } = useFetchNextcloudDirsQuery(!isNextcloudEnabled);
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
  const generateOcr = useGenerateOcrMutation();

  const onGenerateEventAlbumsButtonClick = () => {
    generateAutoAlbums();
  };

  const onDeleteMissingPhotosButtonClick = () => {
    deleteMissingPhotos.mutate();
    close();
  };

  const isAdmin = !!auth?.access?.is_admin;
  // Without a scan directory an admin can still set one up from the Scan button; anyone else has
  // to ask an admin, so say so up front instead of only after a click.
  const hasScanDirectory = !!userSelfDetails?.scan_directory;
  const scanBlocked = !hasScanDirectory && !isAdmin;

  const guardScan = (run: () => void) => {
    if (hasScanDirectory) {
      run();
      return;
    }
    if (isAdmin) {
      setScanDirectorySetupOpen(true);
    } else {
      notification.scanDirectoryRequired();
    }
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
    if (userSelfDetails) {
      setEditedUser(userSelfDetails);
    }
  }, [userSelfDetails]);

  useEffect(() => {
    if (worker) {
      setWorkerAvailability(worker.queue_can_accept_job);
    }
  }, [worker]);

  useEffect(() => {
    if (!isNextcloudEnabled) {
      return;
    }
    if (isNextcloudFetching === true) {
      setNextcloudStatusColor("blue");
    } else if (isNextcloudSuccess === true && userSelfDetails?.nextcloud_server_address) {
      setNextcloudStatusColor("green");
    } else if (isNextcloudError === true) {
      setNextcloudStatusColor("red");
    }
  }, [isNextcloudEnabled, isNextcloudFetching, isNextcloudSuccess, isNextcloudError, userSelfDetails]);

  if (avatarImgSrc === "/unknown_user.jpg") {
    if (userSelfDetails?.avatar_url) {
      setAvatarImgSrc(serverAddress + userSelfDetails.avatar_url);
    }
  }

  // Edits build on the pending edits, not on the saved profile, so that filling in one Nextcloud
  // field keeps what was typed into the others. Read the value first: React clears
  // currentTarget before a functional update runs.
  const editNextcloudField =
    (field: "nextcloud_server_address" | "nextcloud_username" | "nextcloud_app_password") =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const { value } = event.currentTarget;
      setEditedUser(prev => (prev ? { ...prev, [field]: value } : prev));
    };
  const handleNextcloudServerAddressChange = editNextcloudField("nextcloud_server_address");
  const handleNextcloudUsernameChange = editNextcloudField("nextcloud_username");
  const handleNextcloudPasswordChange = editNextcloudField("nextcloud_app_password");

  const handleSubmit = () => {
    if (editedUser) {
      const newUserData = { ...editedUser };
      delete newUserData.scan_directory;
      delete newUserData.avatar;
      // Keep the dialog open when the server rejects the save (an unsafe Nextcloud address, for
      // example), so the edits can be fixed.
      updateUser.mutate(newUserData, {
        onSuccess: () => setIsOpenUpdateDialog(false),
        onError: reportUserSaveError,
      });
    }
  };

  const regenerateEventTitles = () => {
    // /autoalbumtitlegen/ re-titles every existing event album; /autoalbumgen/ would only
    // title the albums whose photos changed. fetchClient already reports server errors.
    fetchClient
      .post("/autoalbumtitlegen/", {})
      .then(() => notification.regenerateEventAlbums())
      .catch(() => {});
  };

  const handleCancel = () => {
    if (userSelfDetails) {
      setEditedUser(userSelfDetails);
    }
    setIsOpenUpdateDialog(false);
  };

  if (!userSelfDetails) {
    return <Loader />;
  }

  return (
    <Container>
      <Group gap="xs" mt={{ base: 20, sm: 40 }} mb={{ base: 10, sm: 20 }}>
        <Book size={35} />
        <Title order={1}>{t("settings.library")}</Title>
      </Group>

      <Stack>
        <CountStats />
        <Card shadow="md">
          <Stack>
            <Title order={4}>
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
                  <Text size="sm">{t("settings.missingphotosconfirm")}</Text>
                  <Group justify="flex-end">
                    <Button variant="default" onClick={close}>
                      {t("cancel")}
                    </Button>
                    <Button color="red" onClick={onDeleteMissingPhotosButtonClick}>
                      {t("confirm")}
                    </Button>
                  </Group>
                </Stack>
              </Modal>
            </Title>

            {/*
              Every row below is a description plus an action. The description column takes whatever
              is left over ("auto") and the action column is sized to its content ("content"), so
              that a translated label longer than the English one still fits instead of being cut
              off by a fixed column width.
            */}

            <Grid>
              <Grid.Col span={{ base: 12, sm: "auto" }}>
                <Stack gap={0}>
                  <Group gap="xs">
                    <Text>{t("settings.scanlibrary")}</Text>
                    {/* The handler sits on the button, not the icon, so Enter and Space work too. */}
                    <ActionIcon
                      radius="xl"
                      variant="light"
                      size="xs"
                      aria-label={t("settings.scanhelp")}
                      aria-expanded={isScanHelpOpen}
                      aria-controls="scan-library-help"
                      onClick={() => setIsScanHelpOpen(open => !open)}
                    >
                      <QuestionMark size={14} />
                    </ActionIcon>
                  </Group>
                  <Text fz="sm" c="dimmed">
                    {t("settings.scanphotosdescription")}
                  </Text>
                  {scanBlocked && (
                    <Text fz="sm" c="orange">
                      {t("toasts.scan_directory_required")}
                    </Text>
                  )}
                  {/* In the description column, so the collapsed help adds no gap to the rows. */}
                  <Collapse in={isScanHelpOpen} id="scan-library-help">
                    <Stack gap={0} mt="xs">
                      <Text>{t("settings.scanhelpheading")}</Text>
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
                              If the filepath exists, check if the file has been modified. If it was modified, rescan
                              the image. If not, we skip.
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
                            <Trans i18nKey="settings.scannextclouddescription.item5">
                              Generate a number of thumbnails
                            </Trans>
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
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
                <Group wrap="nowrap" gap={0} justify="flex-end">
                  <Button
                    onClick={() => guardScan(() => scanPhotos.mutate())}
                    disabled={!workerAvailability || scanBlocked}
                    leftSection={<Refresh />}
                    variant="filled"
                    style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                    fullWidth
                  >
                    {t("settings.statusscanphotosfalse")}
                  </Button>
                  <Menu transitionProps={{ transition: "pop" }} position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon
                        variant="filled"
                        color="blue"
                        size={36}
                        disabled={!workerAvailability || scanBlocked}
                        aria-label={t("settings.statusrescanphotosfalse")}
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
                        onClick={() => guardScan(() => rescanPhotos.mutate())}
                        disabled={!workerAvailability || scanBlocked}
                      >
                        {t("settings.statusrescanphotosfalse")}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Grid.Col>
            </Grid>

            <Divider labelPosition="left" label={<Text fw="bold">{t("settings.eventsalbums")}</Text>} mt={20} />
            <Grid>
              <Grid.Col span={{ base: 12, sm: "auto" }}>
                <Stack gap={0}>
                  <Text>{t("settings.eventalbumsgenerate")}</Text>
                  <Text fz="sm" c="dimmed">
                    {t("settings.eventsalbumsdescription")}
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
                <Button
                  onClick={onGenerateEventAlbumsButtonClick}
                  disabled={!workerAvailability}
                  leftSection={<RefreshDot />}
                  variant="outline"
                  fullWidth
                >
                  {t("settings.generate")}
                </Button>
              </Grid.Col>
            </Grid>

            <Grid>
              <Grid.Col span={{ base: 12, sm: "auto" }}>
                <Stack gap={0}>
                  <Text>{t("settings.eventalbumsregenerate")}</Text>
                  <Text fz="sm" c="dimmed">
                    {t("settings.eventalbumsregeneratedescription")}
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
                <Button
                  onClick={regenerateEventTitles}
                  disabled={!workerAvailability}
                  leftSection={<RefreshDot />}
                  variant="outline"
                  fullWidth
                >
                  {t("settings.regenerate")}
                </Button>
              </Grid.Col>
            </Grid>
            <Divider
              labelPosition="left"
              label={
                <Text fw="bold">
                  {t("settings.faces")} & {t("settings.people")}
                </Text>
              }
              mt={20}
            />
            <Grid>
              <Grid.Col span={{ base: 12, sm: "auto" }}>
                <Stack gap={0}>
                  <Text>{t("settings.trainfacestitle")}</Text>
                  <Text fz="sm" c="dimmed">
                    {t("settings.trainfacesdescription")}
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
                <Button
                  disabled={!workerAvailability}
                  onClick={() => trainFaces.mutate()}
                  leftSection={<FaceId />}
                  variant="outline"
                  fullWidth
                >
                  <Trans i18nKey="settings.facesbutton">Train Faces</Trans>
                </Button>
              </Grid.Col>
            </Grid>
            <Grid>
              <Grid.Col span={{ base: 12, sm: "auto" }}>
                <Stack gap={0}>
                  <Text>{t("settings.rescanfacestitle")}</Text>
                  <Text fz="sm" c="dimmed">
                    {t("settings.rescanfacesdescription")}
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
                <Button
                  disabled={!workerAvailability}
                  onClick={() => {
                    fetchClient
                      .get("/scanfaces")
                      .then(() => notification.rescanFaces())
                      .catch(() => notification.rescanFacesFailed());
                  }}
                  leftSection={<FaceId />}
                  variant="outline"
                  fullWidth
                >
                  <Trans i18nKey="settings.rescanfaces">Rescan</Trans>
                </Button>
              </Grid.Col>
            </Grid>
            <Divider labelPosition="left" label={<Text fw="bold">{t("settings.textrecognition")}</Text>} mt={20} />
            <Grid>
              <Grid.Col span={{ base: 12, sm: "auto" }}>
                <Stack gap={0}>
                  <Text>{t("settings.ocrtitle")}</Text>
                  <Text fz="sm" c="dimmed">
                    {isOcrEnabled
                      ? t("settings.ocrdescription")
                      : t(isAdmin ? "settings.ocrdisabled" : "settings.ocrdisablednonadmin")}
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
                <Group wrap="nowrap" gap={0} justify="flex-end">
                  <Button
                    disabled={!workerAvailability || !isOcrEnabled}
                    onClick={() => generateOcr.mutate(false)}
                    leftSection={<TextRecognition />}
                    variant="outline"
                    style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 0 }}
                    fullWidth
                  >
                    {t("settings.ocrbutton")}
                  </Button>
                  <Menu transitionProps={{ transition: "pop" }} position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon
                        variant="outline"
                        size={36}
                        disabled={!workerAvailability || !isOcrEnabled}
                        aria-label={t("settings.ocrfullbutton")}
                        style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                      >
                        <ChevronDown size="1rem" />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<TextRecognition size="1rem" />}
                        onClick={() => generateOcr.mutate(true)}
                        disabled={!workerAvailability || !isOcrEnabled}
                      >
                        {t("settings.ocrfullbutton")}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Grid.Col>
            </Grid>
            {isNextcloudEnabled && (
              <>
                <Divider labelPosition="left" label={<Text fw="bold">{t("settings.nextcloudheader")}</Text>} mt={20} />
                {/*
                One grid per row: a content sized column may not share a flex line with the fixed
                width columns of the credentials rows below, otherwise those would move up into it.
              */}
                <Stack>
                  <Grid>
                    <Grid.Col span={{ base: 12, sm: "auto" }}>
                      <Stack gap={0}>
                        <Text>{t("joblist.status")}</Text>
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: "content" }}>
                      <Badge
                        leftSection={BadgeIcon(
                          userSelfDetails,
                          isNextcloudSuccess,
                          isNextcloudError,
                          isNextcloudFetching
                        )}
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
                  </Grid>
                  <Grid>
                    <Grid.Col span={{ base: 12, sm: 7 }}>
                      <Stack gap={0}>
                        <Trans i18nKey="settings.serveradress" />
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 5 }}>
                      <TextInput
                        onChange={handleNextcloudServerAddressChange}
                        value={editedUser?.nextcloud_server_address ?? ""}
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
                        onChange={handleNextcloudUsernameChange}
                        value={editedUser?.nextcloud_username ?? ""}
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
                        onChange={handleNextcloudPasswordChange}
                        type="password"
                        placeholder={t("settings.nextcloudpasswordplaceholder")}
                        value={editedUser?.nextcloud_app_password ?? ""}
                      />
                    </Grid.Col>
                  </Grid>
                  <Grid>
                    <Grid.Col span={{ base: 12, sm: "auto" }}>
                      <Stack gap={0}>
                        <Trans i18nKey="settings.nextcloudscandirectory" />
                        <Text size="sm" c="dimmed">
                          {editedUser?.nextcloud_scan_directory || t("settings.nextcloudscandirectoryplaceholder")}
                        </Text>
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
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
                  </Grid>
                  <Grid justify="flex-end">
                    <Grid.Col span={{ base: 12, sm: "content" }}>
                      <Button
                        onClick={() => {
                          scanNextcloudPhotos.mutate();
                        }}
                        disabled={
                          isNextcloudFetching || !workerAvailability || !userSelfDetails.nextcloud_server_address
                        }
                        variant="filled"
                        leftSection={<BrandNextcloud />}
                        fullWidth
                      >
                        <Trans i18nKey="settings.scannextcloudphotos">Scan photos (Nextcloud)</Trans>
                      </Button>
                    </Grid.Col>
                  </Grid>
                </Stack>
                <ModalNextcloudScanDirectoryEdit
                  path={editedUser?.nextcloud_scan_directory ?? userSelfDetails.nextcloud_scan_directory}
                  isOpen={modalNextcloudScanDirectoryOpen}
                  onChange={path => setEditedUser(prev => (prev ? { ...prev, nextcloud_scan_directory: path } : prev))}
                  onClose={() => {
                    setModalNextcloudScanDirectoryOpen(false);
                  }}
                />
              </>
            )}
          </Stack>
        </Card>

        <ModalUserEdit
          onRequestClose={() => setScanDirectorySetupOpen(false)}
          userToEdit={userSelfDetails}
          isOpen={scanDirectorySetupOpen}
          updateAndScan
          userList={userList ?? []}
          createNew={false}
          firstTimeSetup
        />

        <SaveChangesDialog
          opened={isOpenUpdateDialog}
          saving={updateUser.isPending}
          onSave={handleSubmit}
          onCancel={handleCancel}
        />
      </Stack>
      <Space h="xl" />
    </Container>
  );
}
