import type { LocationSummaryResponse } from "@librephotos/api-client";
import { Group, Radio, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

/** Which of the selected photos get the location: those without one, or all of them. */
export type LocationTargets = "missing" | "all";

/** Whether saving replaces locations, and how many photos it sets. */
export function savePlan(summary: LocationSummaryResponse, targets: LocationTargets) {
  const missing = summary.count - summary.with_location;
  // With every photo located there is nothing else to set: saving replaces them.
  const overwrite = targets === "all" || missing === 0;
  return { overwrite, count: overwrite ? summary.count : missing };
}

type Props = Readonly<{
  summary: LocationSummaryResponse;
  targets: LocationTargets;
  onChange: (targets: LocationTargets) => void;
}>;

/**
 * The top of the bulk location picker (#2279): how many of the selected photos already have a
 * location, and whether to set it on the others only (the default) or on all of them, with the
 * places a replacement takes away. Nothing when none has a location.
 */
export function BulkLocationChoice({ summary, targets, onChange }: Props) {
  const { t } = useTranslation();
  const { count, with_location: located } = summary;
  if (located === 0) return null;
  const places = summary.places.map(place => place.place).join(", ");
  if (located === count) {
    const text = places
      ? t("locationpicker.bulk_all_located_places", { count, places })
      : t("locationpicker.bulk_all_located", { count });
    return <ReplaceWarning text={text} />;
  }
  const replaces = places
    ? t("locationpicker.bulk_replaces_places", { count: located, places })
    : t("locationpicker.bulk_replaces", { count: located });
  return (
    <Stack gap="xs">
      <Radio.Group
        value={targets}
        onChange={value => onChange(value === "all" ? "all" : "missing")}
        label={t("locationpicker.bulk_located", { count: located, total: count })}
      >
        <Stack gap={6} mt={6}>
          <Radio value="missing" label={t("locationpicker.bulk_only_missing", { count: count - located })} />
          <Radio value="all" label={t("locationpicker.bulk_all", { count, located })} />
        </Stack>
      </Radio.Group>
      {targets === "all" && <ReplaceWarning text={replaces} />}
    </Stack>
  );
}

function ReplaceWarning({ text }: Readonly<{ text: string }>) {
  return (
    <Group gap={6} wrap="nowrap" align="flex-start">
      <Text component="span" lh={0} mt={2} c="orange.8" aria-hidden>
        <IconAlertTriangle size={16} />
      </Text>
      <Text size="sm" c="light-dark(var(--mantine-color-orange-8), var(--mantine-color-orange-4))">
        {text}
      </Text>
    </Group>
  );
}
