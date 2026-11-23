import type { DateSummary } from "@librephotos/api-client";
import { Select, SimpleGrid, Stack, Text } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchTimezonesQuery } from "../../api_client/settings/hooks/useFetchTimezonesQuery";
import { convertPhotoTimestamp } from "../../util/dateUtils";
import type { ChangeDateTimeValues } from "./ChangeDateTimeModal.schema";
import { DateTimePreviewTable } from "./DateTimePreviewTable";

type Props = Readonly<{
  form: UseFormReturnType<ChangeDateTimeValues>;
  summary: DateSummary;
}>;

export function ConvertTimeZoneFields({ form, summary }: Props) {
  const { t } = useTranslation();
  const { data: timezones = [] } = useFetchTimezonesQuery();
  const { fromTimezone, toTimezone } = form.getValues();
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {t("changedatetime.converthint")}
      </Text>
      <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
        <Select
          searchable
          label={t("changedatetime.fromzone")}
          description={t("changedatetime.fromzonedescription")}
          placeholder={t("changedatetime.zoneplaceholder")}
          data={[...timezones]}
          {...form.getInputProps("fromTimezone")}
          value={fromTimezone || null}
          onChange={(zone: string | null) => form.setFieldValue("fromTimezone", zone ?? "")}
        />
        <Select
          searchable
          label={t("changedatetime.tozone")}
          description={t("changedatetime.tozonedescription")}
          placeholder={t("changedatetime.zoneplaceholder")}
          data={[...timezones]}
          {...form.getInputProps("toTimezone")}
          value={toTimezone || null}
          onChange={(zone: string | null) => form.setFieldValue("toTimezone", zone ?? "")}
        />
      </SimpleGrid>
      <DateTimePreviewTable
        summary={summary}
        after={photo =>
          fromTimezone && toTimezone ? convertPhotoTimestamp(photo.exif_timestamp, fromTimezone, toTimezone) : null
        }
        pending="—"
        withSeconds={false}
      />
      {summary.without_date > 0 && (
        <Text size="sm" c="orange">
          {t("changedatetime.skipped", { count: summary.without_date })}
        </Text>
      )}
    </Stack>
  );
}
