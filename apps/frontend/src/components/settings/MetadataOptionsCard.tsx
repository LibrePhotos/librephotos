import { Card, Flex, Group, Radio, Select, Title } from "@mantine/core";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { useFetchTimezonesQuery } from "../../api_client/settings";
import { SectionLink } from "./SettingsSection";
import type { UserSettingsCardProps } from "./userSettingsCard";

export function MetadataOptionsCard({ user, onChange }: UserSettingsCardProps) {
  const { t } = useTranslation();
  const { data: timezoneList = [] } = useFetchTimezonesQuery();

  return (
    <Card shadow="md">
      <Title order={4} mb={16}>
        <Trans i18nKey="settings.metadata" />
        <SectionLink />
      </Title>
      <Flex align="flex-start" direction="column" gap="md">
        <Radio.Group
          label={t("settings.sync")}
          description={t("settings.syncdescription")}
          value={user.save_metadata_to_disk}
          onChange={value => onChange({ save_metadata_to_disk: value || "OFF" })}
        >
          <Group mt="xs">
            <Radio value="OFF" label={t("settings.favoritesyncoptions.off")} />
            <Radio value="SIDECAR_FILE" label={t("settings.favoritesyncoptions.sidecar")} />
            <Radio value="MEDIA_FILE" label={t("settings.favoritesyncoptions.mediafile")} />
          </Group>
        </Radio.Group>
        <Radio.Group
          label={t("settings.favoriteminimum")}
          value={user.favorite_min_rating?.toString()}
          onChange={value => onChange({ favorite_min_rating: parseInt(value, 10) || 3 })}
        >
          <Group mt="xs">
            <Radio value="1" label="1" />
            <Radio value="2" label="2" />
            <Radio value="3" label="3" />
            <Radio value="4" label="4" />
            <Radio value="5" label="5" />
          </Group>
        </Radio.Group>
        <Select
          label={t("defaulttimezone")}
          description={t("timezoneexplain")}
          value={user.default_timezone}
          placeholder={t("defaulttimezone")}
          searchable
          allowDeselect={false}
          onChange={value => onChange({ default_timezone: value ?? "UTC" })}
          data={timezoneList}
        />
      </Flex>
    </Card>
  );
}
