import { RatingMode, type User } from "@librephotos/api-client";
import { Card, Flex, Group, Input, Radio, SegmentedControl, Select, Stack, Title } from "@mantine/core";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { useFetchTimezonesQuery } from "../../api_client/settings";
import { listFields, WRITTEN_FIELDS, type WriteMode } from "./metadataWrite";
import { SectionLink } from "./SettingsSection";
import type { UserSettingsCardProps } from "./userSettingsCard";
import { WriteExistingEditsRow } from "./WriteExistingEditsRow";

/** "Write edits to files": each option says which edits it writes, from WRITTEN_FIELDS (#2281). */
function WriteEditsChoice({ user, onChange }: UserSettingsCardProps) {
  const { t, i18n } = useTranslation();
  const fields = (mode: WriteMode) => listFields(WRITTEN_FIELDS[mode], t, i18n.language);

  return (
    <Radio.Group
      label={t("settings.sync")}
      description={t("settings.writeeditsdescription")}
      value={user.save_metadata_to_disk}
      onChange={value => onChange({ save_metadata_to_disk: value || "OFF" })}
    >
      {/* Stacked: each option carries a description. */}
      <Stack mt="xs" gap="sm">
        <Radio value="OFF" label={t("settings.favoritesyncoptions.off")} description={t("settings.writeedits.off")} />
        <Radio
          value="SIDECAR_FILE"
          label={t("settings.favoritesyncoptions.sidecar")}
          description={t("settings.writeedits.sidecar", { fields: fields("SIDECAR_FILE") })}
        />
        <Radio
          value="MEDIA_FILE"
          label={t("settings.favoritesyncoptions.mediafile")}
          description={t("settings.writeedits.mediafile", { fields: fields("MEDIA_FILE") })}
        />
      </Stack>
    </Radio.Group>
  );
}

type MetadataOptionsCardProps = UserSettingsCardProps & {
  /** The user as saved, which "Write existing edits to files" writes with (#2287). */
  saved: User;
};

export function MetadataOptionsCard({ user, saved, onChange }: MetadataOptionsCardProps) {
  const { t } = useTranslation();
  const { data: timezoneList = [] } = useFetchTimezonesQuery();

  return (
    <Card shadow="md">
      <Title order={4} mb={16}>
        <Trans i18nKey="settings.metadata" />
        <SectionLink />
      </Title>
      <Flex align="flex-start" direction="column" gap="md">
        <Stack gap="sm" w="100%">
          <WriteEditsChoice user={user} onChange={onChange} />
          <WriteExistingEditsRow saved={saved} edited={user} />
        </Stack>
        <Input.Wrapper
          label={t("settings.ratingstyle")}
          description={t(`settings.ratingstyledescription.${user.rating_mode}`)}
        >
          <SegmentedControl<RatingMode>
            mt="xs"
            value={user.rating_mode}
            onChange={value => onChange({ rating_mode: value })}
            data={RatingMode.options.map(mode => ({ value: mode, label: t(`settings.ratingstyleoptions.${mode}`) }))}
          />
        </Input.Wrapper>
        <Radio.Group
          label={t("settings.favoriteminimum")}
          value={user.favorite_min_rating?.toString()}
          onChange={value => onChange({ favorite_min_rating: Number(value) })}
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
