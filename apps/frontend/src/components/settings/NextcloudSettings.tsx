import { Badge, Button, Divider, Grid, Stack, Text, TextInput } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBrandNextcloud as BrandNextcloud,
  IconCheck as Check,
  IconFolder as Folder,
  IconQuestionMark as QuestionMark,
  IconRefreshDot as RefreshDot,
  IconX as X,
} from "@tabler/icons-react";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { useScanNextcloudPhotosMutation } from "../../api_client/jobs/hooks";
import type { User } from "../../api_client/user/types";
import { ModalNextcloudScanDirectoryEdit } from "../modals/ModalNextcloudScanDirectoryEdit";
import { ACTION_MIN_WIDTH } from "./libraryLayout";

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

type NextcloudSettingsProps = {
  userSelfDetails: User;
  /** The pending edits, saved through the library's save dialog. */
  editedUser: User | null;
  setEditedUser: React.Dispatch<React.SetStateAction<User | null>>;
  workerAvailability: boolean;
  isNextcloudFetching: boolean;
  isNextcloudSuccess: boolean;
  isNextcloudError: boolean;
  nextcloudStatusColor: string;
};

/** The Nextcloud connection: its status, the credentials, the scan directory and the scan button. */
export function NextcloudSettings({
  userSelfDetails,
  editedUser,
  setEditedUser,
  workerAvailability,
  isNextcloudFetching,
  isNextcloudSuccess,
  isNextcloudError,
  nextcloudStatusColor,
}: NextcloudSettingsProps) {
  const { t } = useTranslation();
  const [modalNextcloudScanDirectoryOpen, { open: openNextcloudScanDirectory, close: closeNextcloudScanDirectory }] =
    useDisclosure(false);
  const scanNextcloudPhotos = useScanNextcloudPhotosMutation();

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

  return (
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
                openNextcloudScanDirectory();
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
              disabled={isNextcloudFetching || !workerAvailability || !userSelfDetails.nextcloud_server_address}
              variant="filled"
              leftSection={<BrandNextcloud />}
              fullWidth
            >
              <Trans i18nKey="settings.scannextcloudphotos" />
            </Button>
          </Grid.Col>
        </Grid>
      </Stack>
      <ModalNextcloudScanDirectoryEdit
        path={editedUser?.nextcloud_scan_directory ?? userSelfDetails.nextcloud_scan_directory ?? ""}
        isOpen={modalNextcloudScanDirectoryOpen}
        onChange={path => setEditedUser(prev => (prev ? { ...prev, nextcloud_scan_directory: path } : prev))}
        onClose={() => {
          closeNextcloudScanDirectory();
        }}
      />
    </>
  );
}
