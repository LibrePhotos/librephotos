import { Card, Flex, Select, Switch, Title } from "@mantine/core";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { SectionLink } from "./SettingsSection";
import type { UserSettingsCardProps } from "./userSettingsCard";

const SLIDESHOW_INTERVALS = [3, 5, 10, 15, 30];

export function InterfaceCard({ user, onChange }: UserSettingsCardProps) {
  const { t } = useTranslation();

  return (
    <Card shadow="md">
      <Title order={4} mb={16}>
        <Trans i18nKey="settings.interface" />
        <SectionLink />
      </Title>
      <Flex align="flex-start" direction="column" gap="md">
        <Select
          label={t("settings.slideshowinterval")}
          description={t("settings.slideshowintervaldesc")}
          value={(user.slideshow_interval ?? 5).toString()}
          allowDeselect={false}
          onChange={value => onChange({ slideshow_interval: parseInt(value || "5", 10) })}
          data={SLIDESHOW_INTERVALS.map(seconds => ({
            value: seconds.toString(),
            label: t("settings.slideshowseconds", { count: seconds }),
          }))}
        />
        {/* The What's new card after an update (#2305); an older server does not have the switch. */}
        {user.show_whats_new === undefined ? null : (
          <Switch
            label={t("settings.showwhatsnew")}
            description={t("settings.showwhatsnewdesc")}
            checked={user.show_whats_new}
            onChange={event => onChange({ show_whats_new: event.currentTarget.checked })}
          />
        )}
      </Flex>
    </Card>
  );
}
