import type { User } from "@librephotos/api-client";
import { Card, Container, Space, Stack, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconBook as Book } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth/hooks";
import { useFetchNextcloudDirsQuery } from "../../api_client/folders/hooks/useFetchNextcloudDirsQuery";
import { useRescanPhotosMutation, useScanPhotosMutation } from "../../api_client/jobs/hooks";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useFetchCountStatsQuery } from "../../api_client/stats/hooks";
import { COUNT_STATS_DEFAULTS } from "../../api_client/stats/types";
import { serverAddress } from "../../api_client/urls";
import { useFetchUserListQuery, useUpdateUserMutation } from "../../api_client/user/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useJobQueue } from "../../hooks/useJobQueue";
import { notification } from "../../service/notifications";
import { reportUserSaveError } from "../../util/apiErrors";
import { PageLoader } from "../common/PageLoader";
import { CountStats } from "../CountStats";
import { LibraryFoldersCard } from "../libraryfolders/LibraryFoldersCard";
import { ModalUserEdit } from "../modals/ModalUserEdit";
import { PageHeader } from "../PageHeader";
import { JobQueueBusyNotice } from "./JobQueueBusyNotice";
import { LibraryActions } from "./LibraryActions";
import { MissingPhotosBadge } from "./MissingPhotosBadge";
import { NextcloudSettings } from "./NextcloudSettings";
import { ProcessingStatusCard } from "./ProcessingStatusCard";
import { SaveChangesDialog } from "./SaveChangesDialog";
import { ScanLibraryRow } from "./ScanLibraryRow";

export function Library() {
  const [isOpenUpdateDialog, { open: openUpdateDialog, close: closeUpdateDialog }] = useDisclosure(false);
  const [avatarImgSrc, setAvatarImgSrc] = useState("/unknown_user.jpg");
  const [scanDirectorySetupOpen, { open: openScanDirectorySetup, close: closeScanDirectorySetup }] =
    useDisclosure(false);
  const { data: userSelfDetails } = useCurrentUserSelfDetailsQuery();
  const { data: auth } = useAccessToken();
  const { data: userList } = useFetchUserListQuery();
  const [editedUser, setEditedUser] = useState<User | null>(null);
  const queue = useJobQueue();
  const { t } = useTranslation();
  // Every job button says why it is off while the queue is busy (#2237).
  const busyReason = queue.busy ? t("jobs.queuebusy.reason") : undefined;
  const { data: siteSettings } = useGetSettingsQuery();
  const isNextcloudEnabled = siteSettings?.nextcloud_enabled ?? false;
  const ocrModel = siteSettings?.ocr_model ?? "none";
  const isOcrEnabled = ocrModel.trim().toLowerCase() !== "none";
  const isCaptioningAvailable = siteSettings?.captioning_available ?? false;
  const isThingsAvailable = siteSettings?.things_available ?? false;
  const {
    isFetching: isNextcloudFetching,
    isSuccess: isNextcloudSuccess,
    isError: isNextcloudError,
  } = useFetchNextcloudDirsQuery(!isNextcloudEnabled);
  const [nextcloudStatusColor, setNextcloudStatusColor] = useState("gray");
  const { data: countStats = COUNT_STATS_DEFAULTS } = useFetchCountStatsQuery();
  const updateUser = useUpdateUserMutation({ reportsErrors: true });
  const scanPhotos = useScanPhotosMutation();
  const rescanPhotos = useRescanPhotosMutation();

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
      openScanDirectorySetup();
    } else {
      notification.scanDirectoryRequired();
    }
  };

  // open update dialog, when user was edited
  useEffect(() => {
    if (JSON.stringify(editedUser) !== JSON.stringify(userSelfDetails)) {
      openUpdateDialog();
    } else {
      closeUpdateDialog();
    }
  }, [editedUser, userSelfDetails, openUpdateDialog, closeUpdateDialog]);

  useEffect(() => {
    if (userSelfDetails) {
      setEditedUser(userSelfDetails);
    }
  }, [userSelfDetails]);

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

  const handleSubmit = () => {
    if (editedUser) {
      const newUserData = { ...editedUser };
      delete newUserData.scan_directory;
      delete newUserData.avatar;
      // Keep the dialog open when the server rejects the save (an unsafe Nextcloud address, for
      // example), so the edits can be fixed.
      updateUser.mutate(newUserData, {
        onSuccess: () => closeUpdateDialog(),
        onError: reportUserSaveError,
      });
    }
  };

  const handleCancel = () => {
    if (userSelfDetails) {
      setEditedUser(userSelfDetails);
    }
    closeUpdateDialog();
  };

  if (!userSelfDetails) {
    return <PageLoader />;
  }

  return (
    <Container>
      <PageHeader icon={Book} title={t("settings.library")} />

      <Stack>
        <CountStats />
        <LibraryFoldersCard user={userSelfDetails} isAdmin={isAdmin} />
        <ProcessingStatusCard busyReason={busyReason} uploadOnly={!hasScanDirectory} />
        <Card shadow="md">
          <Stack>
            <Title order={4}>
              <Trans i18nKey="settings.photos" />
              <MissingPhotosBadge count={countStats.num_missing_photos} />
            </Title>

            {/*
              Every row below is a description plus an action. The description column takes whatever
              is left over ("auto") and the action column is sized to its content ("content"), so
              that a translated label longer than the English one still fits instead of being cut
              off by a fixed column width.
            */}

            {queue.busy && <JobQueueBusyNotice job={queue.job} />}

            <ScanLibraryRow
              busyReason={busyReason}
              scanBlocked={scanBlocked}
              onScan={() => guardScan(() => scanPhotos.mutate())}
              onRescan={() => guardScan(() => rescanPhotos.mutate())}
            />

            <LibraryActions
              busyReason={busyReason}
              isAdmin={isAdmin}
              isOcrEnabled={isOcrEnabled}
              isCaptioningAvailable={isCaptioningAvailable}
              isThingsAvailable={isThingsAvailable}
            />
            {isNextcloudEnabled && (
              <NextcloudSettings
                userSelfDetails={userSelfDetails}
                editedUser={editedUser}
                setEditedUser={setEditedUser}
                busyReason={busyReason}
                isNextcloudFetching={isNextcloudFetching}
                isNextcloudSuccess={isNextcloudSuccess}
                isNextcloudError={isNextcloudError}
                nextcloudStatusColor={nextcloudStatusColor}
              />
            )}
          </Stack>
        </Card>

        <ModalUserEdit
          onRequestClose={() => closeScanDirectorySetup()}
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
