import { Group, Stack, Text, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import React from "react";
import { useTranslation } from "react-i18next";
import { i18nResolvedLanguage } from "../../i18n";
import { formatExposureTime, parseExposureTime } from "../../util/exifFormat";
import { RangePresets, type RangeFilterProps } from "./RangeFilter";
import { makeExposureTimeRangeSchema, type ExposureTimeRangeValues } from "./RangeFilter.schema";

const asText = (seconds: number | undefined, language: string) =>
  seconds === undefined ? "" : formatExposureTime(seconds, language);

export function ExposureTimeRangeFilter({ field, low, high, onChange }: RangeFilterProps) {
  const { t } = useTranslation();
  const language = i18nResolvedLanguage();
  const initial: ExposureTimeRangeValues = { low: asText(low, language), high: asText(high, language) };
  const form = useForm<ExposureTimeRangeValues>({
    initialValues: initial,
    validate: schemaResolver(makeExposureTimeRangeSchema(t), { sync: true }),
  });
  const label = t(field.labelKey);
  const labelId = `search-filter-${field.id}`;

  const valueOf = (key: "low" | "high") => {
    const text = form.getValues()[key];
    if (text === initial[key]) return key === "low" ? low : high;
    return parseExposureTime(text);
  };
  const apply = () => {
    if (form.validate().hasErrors) return;
    const nextLow = valueOf("low");
    const nextHigh = valueOf("high");
    if (nextLow !== low || nextHigh !== high) onChange(nextLow, nextHigh);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") apply();
  };
  const input = (key: "low" | "high") => ({
    ...form.getInputProps(key),
    "aria-label": `${label}, ${t(key === "low" ? "searchfilter.min" : "searchfilter.max")}`,
    placeholder: t(key === "low" ? "searchfilter.min" : "searchfilter.max"),
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
        <TextInput {...input("low")} flex={1} />
        <TextInput {...input("high")} flex={1} />
      </Group>
      <RangePresets field={field} low={low} high={high} onChange={onChange} labelId={labelId} />
    </Stack>
  );
}
