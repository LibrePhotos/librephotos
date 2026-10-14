import { Chip, Group, NumberInput, Stack, Text } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { i18nResolvedLanguage } from "../../i18n";
import { makeRangeFilterSchema, type RangeFilterValues } from "./RangeFilter.schema";
import { formatRangeValue } from "./searchFilterLabels";
import type { RangeField } from "./searchFilterRanges";

type Props = Readonly<{
  field: RangeField;
  low: number | undefined;
  high: number | undefined;
  onChange: (low: number | undefined, high: number | undefined) => void;
}>;

const toEnd = (value: number | string): number | undefined => (typeof value === "number" ? value : undefined);

function presetLabel(field: RangeField, min: number | undefined, max: number | undefined, t: TFunction) {
  const ctx = { t, language: i18nResolvedLanguage() };
  if (min !== undefined && max !== undefined) {
    return t("searchfilter.preset.between", {
      low: formatRangeValue(field, min, ctx),
      high: formatRangeValue(field, max, ctx),
    });
  }
  if (min !== undefined) return t("searchfilter.preset.atleast", { low: formatRangeValue(field, min, ctx) });
  return t("searchfilter.preset.upto", { high: formatRangeValue(field, max ?? 0, ctx) });
}

/**
 * A min / max pair with optional one-click bands. The fields apply on blur or Enter; a lowest value
 * above the highest shows an error and is not applied. The parent re-keys it when the URL changes,
 * so the fields always start from the applied range.
 */
export function RangeFilter({ field, low, high, onChange }: Props) {
  const { t } = useTranslation();
  const form = useForm<RangeFilterValues>({
    initialValues: { low: low ?? "", high: high ?? "" },
    validate: schemaResolver(makeRangeFilterSchema(t), { sync: true }),
  });
  const label = t(field.labelKey);
  const labelId = `search-filter-${field.id}`;

  const apply = () => {
    if (form.validate().hasErrors) return;
    const next = form.getValues();
    const nextLow = toEnd(next.low);
    const nextHigh = toEnd(next.high);
    if (nextLow !== low || nextHigh !== high) onChange(nextLow, nextHigh);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") apply();
  };
  const input = (key: "low" | "high") => ({
    ...form.getInputProps(key),
    "aria-label": `${label}, ${t(key === "low" ? "searchfilter.min" : "searchfilter.max")}`,
    placeholder: t(key === "low" ? "searchfilter.min" : "searchfilter.max"),
    allowDecimal: !field.integer,
    allowNegative: false,
    hideControls: true,
    size: "xs",
    onBlur: apply,
    onKeyDown,
  });

  return (
    <Stack gap={4}>
      <Text id={labelId} size="sm" fw={500}>
        {label}
      </Text>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <NumberInput {...input("low")} flex={1} />
        <NumberInput {...input("high")} flex={1} />
      </Group>
      {field.presets.length > 0 && (
        <Group gap={6} role="group" aria-labelledby={labelId}>
          {field.presets.map(preset => {
            const checked = preset.min === low && preset.max === high;
            return (
              <Chip
                key={`${preset.min}-${preset.max}`}
                size="xs"
                checked={checked}
                onChange={() => (checked ? onChange(undefined, undefined) : onChange(preset.min, preset.max))}
              >
                {presetLabel(field, preset.min, preset.max, t)}
              </Chip>
            );
          })}
        </Group>
      )}
    </Stack>
  );
}
