import { Card, Flex, Select, Title } from "@mantine/core";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import type { UserSettingsCardProps } from "./userSettingsCard";

const SLIDESHOW_INTERVALS = [3, 5, 10, 15, 30];

export function InterfaceCard({ user, onChange }: UserSettingsCardProps) {
  const { t } = useTranslation();

  return (
    <Card shadow="md">
      <Title order={4} mb={16}>
        <Trans i18nKey="settings.interface" />
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
      </Flex>
    </Card>
  );
}
