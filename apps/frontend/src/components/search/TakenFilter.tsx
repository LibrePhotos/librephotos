import { Chip, Group, Stack } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import React from "react";
import { useTranslation } from "react-i18next";
import { calendarDaysAgo, calendarYear } from "../../util/dateUtils";

type Props = Readonly<{
  after: string | undefined;
  before: string | undefined;
  onChange: (after: string | undefined, before: string | undefined) => void;
  labelId: string;
}>;

const DAYS_IN_A_YEAR = 365;

type Preset = Readonly<{
  id: string;
  labelKey: "searchfilter.taken.thisyear" | "searchfilter.taken.lastyear" | "searchfilter.taken.last12months";
  range: () => { after: string; before: string | undefined };
}>;

const PRESETS: readonly Preset[] = [
  {
    id: "thisyear",
    labelKey: "searchfilter.taken.thisyear",
    range: () => ({ after: calendarYear(0).first, before: calendarYear(0).last }),
  },
  {
    id: "lastyear",
    labelKey: "searchfilter.taken.lastyear",
    range: () => ({ after: calendarYear(1).first, before: calendarYear(1).last }),
  },
  {
    id: "last12months",
    labelKey: "searchfilter.taken.last12months",
    range: () => ({ after: calendarDaysAgo(DAYS_IN_A_YEAR), before: undefined }),
  },
];

// The day span of the search filters: on or after, on or before (whole days), and year presets.
// Each picker stops at the other's day, so the span cannot turn around.
export function TakenFilter({ after, before, onChange, labelId }: Props) {
  const { t } = useTranslation();
  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <DatePickerInput
          label={t("searchfilter.taken.after")}
          placeholder={t("searchfilter.taken.any")}
          value={after ?? null}
          onChange={value => onChange(value ?? undefined, before)}
          maxDate={before}
          clearable
          size="xs"
          flex={1}
          popoverProps={{ withinPortal: false }}
        />
        <DatePickerInput
          label={t("searchfilter.taken.before")}
          placeholder={t("searchfilter.taken.any")}
          value={before ?? null}
          onChange={value => onChange(after, value ?? undefined)}
          minDate={after}
          clearable
          size="xs"
          flex={1}
          popoverProps={{ withinPortal: false }}
        />
      </Group>
      <Group gap={6} role="group" aria-labelledby={labelId}>
        {PRESETS.map(preset => {
          const range = preset.range();
          const checked = range.after === after && range.before === before;
          return (
            <Chip
              key={preset.id}
              size="xs"
              checked={checked}
              onChange={() => (checked ? onChange(undefined, undefined) : onChange(range.after, range.before))}
            >
              {t(preset.labelKey)}
            </Chip>
          );
        })}
      </Group>
    </Stack>
  );
}
