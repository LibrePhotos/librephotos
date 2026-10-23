import { Card, Stack, Switch, Text, Title } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { SectionLink } from "./SettingsSection";
import type { UserSettingsCardProps } from "./userSettingsCard";

/**
 * What the users you share photos and albums with see (#2722). Places, things and dates always go
 * with a photo; the names of the people on it only with this switch. Public links have their own
 * switches (PublicSharingDefaultsCard).
 */
export function UserSharingCard({ user, onChange }: UserSettingsCardProps) {
  const { t } = useTranslation();
  return (
    <Card shadow="md">
      <Stack>
        <Title order={4}>
          {t("settings.usersharing")}
          <SectionLink />
        </Title>
        <Text size="sm" c="dimmed">
          {t("settings.usersharingdesc")}
        </Text>
        <Switch
          label={t("settings.sharepeoplenames")}
          description={t("settings.sharepeoplenamesdesc")}
          checked={user.share_people_names ?? false}
          onChange={event => onChange({ share_people_names: event.currentTarget.checked })}
        />
      </Stack>
    </Card>
  );
}
