import { Anchor, Stack, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronRight } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth/hooks";
import { useFetchNextcloudDirsQuery } from "../../api_client/folders/hooks/useFetchNextcloudDirsQuery";
import { useRescanPhotosMutation, useScanPhotosMutation } from "../../api_client/jobs/hooks";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useFetchCountStatsQuery } from "../../api_client/stats/hooks";
import { COUNT_STATS_DEFAULTS } from "../../api_client/stats/types";
import { serverAddress } from "../../api_client/urls";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useJobQueue } from "../../hooks/useJobQueue";
import { notification } from "../../service/notifications";
import { PageLoader } from "../common/PageLoader";
import { CountStats } from "../CountStats";
import { LibraryFoldersCard } from "../libraryfolders/LibraryFoldersCard";
import { ModalUserEdit } from "../modals/ModalUserEdit";
import { PageHeader } from "../PageHeader";
import { SettingsPageFrame } from "../SettingsPageFrame";
import { JobQueueBusyNotice } from "./JobQueueBusyNotice";
import classes from "./Library.module.css";
import { LibraryActions } from "./LibraryActions";
import { MissingPhotosBadge } from "./MissingPhotosBadge";
import { NextcloudSettings } from "./NextcloudSettings";
import { ProcessingStatusCard } from "./ProcessingStatusCard";
import { SaveChangesDialog } from "./SaveChangesDialog";
import { ScanLibraryRow } from "./ScanLibraryRow";
import { SettingsCard } from "./SettingsCard";
import { useUserSettingsDraft } from "./useUserSettingsDraft";

export function Library() {
  const [avatarImgSrc, setAvatarImgSrc] = useState("/unknown_user.jpg");
  const [scanDirectorySetupOpen, { open: openScanDirectorySetup, close: closeScanDirectorySetup }] =
    useDisclosure(false);
  const { data: userSelfDetails } = useCurrentUserSelfDetailsQuery();
  const { data: auth } = useAccessToken();
  const { data: userList } = useFetchUserListQuery();
  const draft = useUserSettingsDraft(userSelfDetails);
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
  const { data: countStats = COUNT_STATS_DEFAULTS } = useFetchCountStatsQuery();
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

  if (avatarImgSrc === "/unknown_user.jpg") {
    if (userSelfDetails?.avatar_url) {
      setAvatarImgSrc(serverAddress + userSelfDetails.avatar_url);
    }
  }

  if (!userSelfDetails || !draft.user) {
    return <PageLoader />;
  }

  return (
    <SettingsPageFrame
      header={
        <PageHeader
          title={t("settings.library")}
          actions={
            <Anchor component={Link} to="/statistics" size="sm" className={classes.statisticsLink}>
              {t("countstats.viewstatistics")}
              <IconChevronRight size={14} />
            </Anchor>
          }
        />
      }
    >
      <Stack>
        <CountStats />
        <LibraryFoldersCard user={userSelfDetails} isAdmin={isAdmin} />
        <ProcessingStatusCard busyReason={busyReason} uploadOnly={!hasScanDirectory} />
        <SettingsCard>
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
                editedUser={draft.user}
                onEdit={draft.edit}
                busyReason={busyReason}
                isNextcloudFetching={isNextcloudFetching}
                isNextcloudSuccess={isNextcloudSuccess}
                isNextcloudError={isNextcloudError}
              />
            )}
          </Stack>
        </SettingsCard>

        <ModalUserEdit
          onRequestClose={() => closeScanDirectorySetup()}
          userToEdit={userSelfDetails}
          isOpen={scanDirectorySetupOpen}
          updateAndScan
          userList={userList ?? []}
          createNew={false}
          firstTimeSetup
        />

        {/* A refused save (an unsafe Nextcloud address, for example) keeps the edits and the prompt. */}
        <SaveChangesDialog
          opened={draft.pending}
          saving={draft.saving}
          onSave={() => void draft.save()}
          onCancel={draft.discard}
        />
      </Stack>
    </SettingsPageFrame>
  );
}
