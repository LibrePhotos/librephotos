import type { DateSummary } from "@librephotos/api-client";
import { Button, Group, NumberInput, SegmentedControl, SimpleGrid, Stack, Text } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { describeDuration, shiftPhotoTimestamp } from "../../util/dateUtils";
import {
  SHIFT_UNITS,
  shiftSeconds,
  UNIT_MAX,
  type ChangeDateTimeValues,
  type ShiftDirection,
} from "./ChangeDateTimeModal.schema";
import { DateTimePreviewTable } from "./DateTimePreviewTable";

type Props = Readonly<{
  form: UseFormReturnType<ChangeDateTimeValues>;
  summary: DateSummary;
}>;

const UNIT_LABELS: Readonly<Record<(typeof SHIFT_UNITS)[number], ParseKeys>> = {
  days: "changedatetime.days",
  hours: "changedatetime.hours",
  minutes: "changedatetime.minutes",
  seconds: "changedatetime.seconds",
};

/** "1 hour, 30 minutes earlier", or "No change yet": read out as the fields change. */
function ShiftSummary({ seconds }: Readonly<{ seconds: number }>) {
  const { t } = useTranslation();
  let text = t("changedatetime.nochange");
  if (seconds !== 0) {
    const key = seconds < 0 ? "changedatetime.summaryearlier" : "changedatetime.summarylater";
    text = t(key, { duration: describeDuration(seconds) });
  }
  return (
    <Text size="sm" c={seconds === 0 ? "dimmed" : undefined} fw={seconds === 0 ? undefined : 500} aria-live="polite">
      {text}
    </Text>
  );
}

/** The Shift tab: direction, one-hour shortcuts, the amount, its summary and the preview. */
export function ShiftDateFields({ form, summary }: Props) {
  const { t } = useTranslation();
  // One hour either way: the camera clock left on summer time, or set an hour off.
  const oneHour = (direction: ShiftDirection) =>
    form.setValues({ direction, days: 0, hours: 1, minutes: 0, seconds: 0 });
  const values = form.getValues();
  const seconds = shiftSeconds(values);
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {t("changedatetime.shifthint")}
      </Text>
      <Group gap="xs" wrap="wrap">
        <SegmentedControl
          aria-label={t("changedatetime.direction")}
          data={[
            { value: "earlier", label: t("changedatetime.earlier") },
            { value: "later", label: t("changedatetime.later") },
          ]}
          {...form.getInputProps("direction")}
        />
        <Button variant="light" size="compact-sm" onClick={() => oneHour("earlier")}>
          {t("changedatetime.hourearlier")}
        </Button>
        <Button variant="light" size="compact-sm" onClick={() => oneHour("later")}>
          {t("changedatetime.hourlater")}
        </Button>
      </Group>
      <SimpleGrid cols={{ base: 2, xs: 4 }} spacing="xs">
        {SHIFT_UNITS.map(unit => (
          <NumberInput
            key={unit}
            label={t(UNIT_LABELS[unit])}
            min={0}
            max={UNIT_MAX[unit]}
            allowNegative={false}
            allowDecimal={false}
            clampBehavior="strict"
            {...form.getInputProps(unit)}
          />
        ))}
      </SimpleGrid>
      <ShiftSummary seconds={seconds} />
      <DateTimePreviewTable summary={summary} after={photo => shiftPhotoTimestamp(photo.exif_timestamp, seconds)} />
      {summary.without_date > 0 && (
        <Text size="sm" c="orange">
          {t("changedatetime.skipped", { count: summary.without_date })}
        </Text>
      )}
    </Stack>
  );
}
