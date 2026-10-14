import type { MetadataValueField } from "@librephotos/api-client";
import { Group, Loader, Select, Text } from "@mantine/core";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMetadataValuesQuery } from "../../api_client/search/hooks";
import { i18nResolvedLanguage } from "../../i18n";

const LABEL_KEYS = {
  make: "searchfilter.make.label",
  camera: "searchfilter.camera.label",
  lens: "searchfilter.lens.label",
} as const;

const PLACEHOLDER_KEYS = {
  make: "searchfilter.make.placeholder",
  camera: "searchfilter.camera.placeholder",
  lens: "searchfilter.lens.placeholder",
} as const;

type Props = Readonly<{
  field: MetadataValueField;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  /** Load the suggestions only once the panel is open. */
  active: boolean;
}>;

function countFormat() {
  try {
    return new Intl.NumberFormat(i18nResolvedLanguage());
  } catch {
    // An unknown language tag
    return new Intl.NumberFormat("en");
  }
}

// A maker, camera or lens: the values of the user's own photos, most used first, with how many
// photos each one took (library-wide, not the current results).
export function MetadataValueSelect({ field, value, onChange, active }: Props) {
  const { t } = useTranslation();
  const { data, isLoading } = useMetadataValuesQuery(field, active);
  const counts = useMemo(() => new Map((data ?? []).map(row => [row.value, row.count])), [data]);
  const options = useMemo(() => {
    const values = (data ?? []).map(row => row.value);
    // A value from a link may not be among the suggestions (no photo has it any more): keep it pickable.
    return value && !counts.has(value) ? [value, ...values] : values;
  }, [data, counts, value]);
  const format = useMemo(countFormat, []);

  return (
    <Select
      label={t(LABEL_KEYS[field])}
      placeholder={t(PLACEHOLDER_KEYS[field])}
      data={options}
      value={value ?? null}
      onChange={next => onChange(next ?? undefined)}
      searchable
      clearable
      nothingFoundMessage={t("searchfilter.nosuggestions")}
      rightSection={isLoading ? <Loader size="xs" /> : undefined}
      comboboxProps={{ withinPortal: false }}
      renderOption={({ option }) => {
        const count = counts.get(option.value);
        return (
          <Group gap="xs" wrap="nowrap" justify="space-between" w="100%">
            <Text size="sm" truncate>
              {option.label}
            </Text>
            {count !== undefined && (
              <Text size="xs" c="dimmed">
                {format.format(count)}
              </Text>
            )}
          </Group>
        );
      }}
    />
  );
}
