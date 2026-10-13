import { Card, Switch, Title } from "@mantine/core";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import type { UserSettingsCardProps } from "./userSettingsCard";

export function ExperimentalOptionsCard({ user, onChange }: UserSettingsCardProps) {
  const { t } = useTranslation();

  return (
    <Card shadow="md">
      <Title order={4} mb={16}>
        <Trans i18nKey="settings.experimentaloptions" />
      </Title>
      <Switch
        label={t("settings.transcodevideo")}
        description={t("settings.transcodevideodescription")}
        checked={user.transcode_videos}
        onChange={event => onChange({ transcode_videos: event.currentTarget.checked })}
      />
    </Card>
  );
}
