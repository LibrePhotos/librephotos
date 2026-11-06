import { Switch, Title } from "@mantine/core";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { SettingsCard } from "./SettingsCard";
import { SectionLink } from "./SettingsSection";
import type { UserSettingsCardProps } from "./userSettingsCard";

export function ExperimentalOptionsCard({ user, onChange }: UserSettingsCardProps) {
  const { t } = useTranslation();

  return (
    <SettingsCard>
      <Title order={4} mb={16}>
        <Trans i18nKey="settings.experimentaloptions" />
        <SectionLink />
      </Title>
      <Switch
        label={t("settings.transcodevideo")}
        description={t("settings.transcodevideodescription")}
        checked={user.transcode_videos}
        onChange={event => onChange({ transcode_videos: event.currentTarget.checked })}
      />
    </SettingsCard>
  );
}
