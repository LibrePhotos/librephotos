import { userKeys, type User } from "@librephotos/api-client";
import { Card, Container, Space, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconSettings as SettingIcon } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth";
import { useFetchUserSelfDetailsQuery, useUpdateUserMutation } from "../../api_client/user/hooks";
import { reportUserSaveError } from "../../util/apiErrors";
import { PageHeader } from "../PageHeader";
import { CaptionContextCard } from "./CaptionContextCard";
import { ConfigBurstDetection } from "./ConfigBurstDetection";
import { ConfigDateTime } from "./ConfigDateTime";
import { DuplicateDetectionCard } from "./DuplicateDetectionCard";
import { ExperimentalOptionsCard } from "./ExperimentalOptionsCard";
import { FaceOptionsCard } from "./FaceOptionsCard";
import { InterfaceCard } from "./InterfaceCard";
import { MetadataOptionsCard } from "./MetadataOptionsCard";
import { PublicSharingDefaultsCard } from "./PublicSharingDefaultsCard";
import { SaveChangesDialog } from "./SaveChangesDialog";
import { ScanOptionsCard } from "./ScanOptionsCard";

export function Settings() {
  const [isOpenUpdateDialog, { open: openUpdateDialog, close: closeUpdateDialog }] = useDisclosure(false);
  const { data: auth } = useAccessToken();
  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(auth?.access?.user_id.toString() ?? "");
  const [editedUserDetails, setEditedUserDetails] = useState(userSelfDetails);
  const { t } = useTranslation();
  const updateUser = useUpdateUserMutation({ reportsErrors: true });
  const queryClient = useQueryClient();

  // open update dialog, when user was edited
  useEffect(() => {
    if (userSelfDetails && editedUserDetails && JSON.stringify(userSelfDetails) !== JSON.stringify(editedUserDetails)) {
      openUpdateDialog();
    } else {
      closeUpdateDialog();
    }
  }, [userSelfDetails, editedUserDetails, openUpdateDialog, closeUpdateDialog]);

  useEffect(() => {
    if (auth?.access?.user_id) {
      queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
    }
  }, [auth?.access?.user_id, queryClient]);

  useEffect(() => {
    if (userSelfDetails) {
      setEditedUserDetails(userSelfDetails);
    }
  }, [userSelfDetails]);

  if (!userSelfDetails || !editedUserDetails) {
    return null;
  }

  const edit = (patch: Partial<User>) => setEditedUserDetails({ ...editedUserDetails, ...patch });
  const cardProps = { user: editedUserDetails, onChange: edit };

  return (
    <Container>
      <PageHeader icon={SettingIcon} title={t("settings.header")} />
      <Stack>
        <ScanOptionsCard {...cardProps} />
        <MetadataOptionsCard {...cardProps} />
        <FaceOptionsCard {...cardProps} />
        <Card shadow="md">
          <ConfigDateTime
            value={editedUserDetails.datetime_rules}
            onChange={value => edit({ datetime_rules: value || "[]" })}
          />
        </Card>
        <Card shadow="md">
          <ConfigBurstDetection
            value={editedUserDetails.burst_detection_rules}
            onChange={value => edit({ burst_detection_rules: value })}
          />
        </Card>
        <ExperimentalOptionsCard {...cardProps} />
        <CaptionContextCard {...cardProps} />
        <PublicSharingDefaultsCard {...cardProps} />
        <InterfaceCard {...cardProps} />
        <DuplicateDetectionCard {...cardProps} />
        <Space h="xl" />
      </Stack>
      <SaveChangesDialog
        opened={isOpenUpdateDialog}
        saving={updateUser.isPending}
        onSave={() => {
          const newUserData = { ...editedUserDetails };
          delete newUserData.scan_directory;
          delete newUserData.avatar;
          // Keep the dialog open when the server rejects the save, so the edits can be fixed.
          updateUser.mutate(newUserData, {
            onSuccess: () => closeUpdateDialog(),
            onError: reportUserSaveError,
          });
        }}
        onCancel={() => {
          setEditedUserDetails(userSelfDetails);
          closeUpdateDialog();
        }}
      />
    </Container>
  );
}
