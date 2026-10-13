import { PublicSharingDefaults } from "@librephotos/api-client";
import { Card, Stack, Switch, Text, Title } from "@mantine/core";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { SectionLink } from "./SettingsSection";
import type { UserSettingsCardProps } from "./userSettingsCard";

type SharingSwitch = keyof PublicSharingDefaults;

export function PublicSharingDefaultsCard({ user, onChange }: UserSettingsCardProps) {
  const { t } = useTranslation();
  // The server always sends the defaults; all off is what it assumes when they are missing.
  const sharingDefaults = user.public_sharing_defaults ?? PublicSharingDefaults.parse({});
  const sharingSwitch = (key: SharingSwitch, label: string, description: string) => (
    <Switch
      label={label}
      description={description}
      checked={sharingDefaults[key]}
      onChange={event =>
        onChange({ public_sharing_defaults: { ...sharingDefaults, [key]: event.currentTarget.checked } })
      }
    />
  );

  return (
    <Card shadow="md">
      <Stack>
        <Title order={4}>
          <Trans i18nKey="settings.publicsharingdefaults" />
          <SectionLink />
        </Title>
        <Text size="sm" c="dimmed">
          {t("settings.publicsharingdefaultsdesc")}
        </Text>
        {sharingSwitch("share_timestamps", t("sharing.shareTimestamps"), t("sharing.shareTimestampsDesc"))}
        {sharingSwitch("share_location", t("sharing.shareLocation"), t("sharing.shareLocationDesc"))}
        {sharingSwitch("share_camera_info", t("sharing.shareCameraInfo"), t("sharing.shareCameraInfoDesc"))}
        {sharingSwitch("share_captions", t("sharing.shareCaptions"), t("sharing.shareCaptionsDesc"))}
        {sharingSwitch("share_faces", t("sharing.shareFaces"), t("sharing.shareFacesDesc"))}
      </Stack>
    </Card>
  );
}
