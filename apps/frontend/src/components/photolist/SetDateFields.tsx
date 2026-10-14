import { Stack, Text } from "@mantine/core";
import { DatePicker, TimeInput } from "@mantine/dates";
import type { UseFormReturnType } from "@mantine/form";
import React from "react";
import { useTranslation } from "react-i18next";
import { parsePickerDate } from "../../util/dateUtils";
import type { ChangeDateTimeValues } from "./ChangeDateTimeModal.schema";

type Props = Readonly<{
  form: UseFormReturnType<ChangeDateTimeValues>;
  /** How many photos get the one date: with more than one, their order is lost. */
  count: number;
}>;

/** The Set tab: the lightbox's day picker and time field, for every selected photo at once. */
export function SetDateFields({ form, count }: Props) {
  const { t } = useTranslation();
  const { day } = form.getValues();
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {t("changedatetime.sethint")}
      </Text>
      {/* The month shown comes only from defaultDate, never from value. */}
      <DatePicker
        aria-label={t("changedatetime.day")}
        value={day}
        defaultDate={day ?? undefined}
        onChange={picked => form.setFieldValue("day", picked ? parsePickerDate(picked) : null)}
      />
      <TimeInput
        withSeconds
        label={t("changedatetime.time")}
        description={t("changedatetime.timehint")}
        maw={200}
        {...form.getInputProps("time")}
      />
      {count > 1 && (
        <Text size="sm" c="dimmed">
          {t("changedatetime.setorderlost")}
        </Text>
      )}
    </Stack>
  );
}
