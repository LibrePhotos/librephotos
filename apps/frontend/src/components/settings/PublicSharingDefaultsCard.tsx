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
  const sharingSwitch = (key: SharingSwitch, label: string) => (
    <Switch
      label={label}
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
        {sharingSwitch("share_timestamps", t("sharing.shareTimestamps"))}
        {sharingSwitch("share_location", t("sharing.shareLocation"))}
        {sharingSwitch("share_camera_info", t("sharing.shareCameraInfo"))}
        {sharingSwitch("share_captions", t("sharing.shareCaptions"))}
        {sharingSwitch("share_faces", t("sharing.shareFaces"))}
      </Stack>
    </Card>
  );
}
