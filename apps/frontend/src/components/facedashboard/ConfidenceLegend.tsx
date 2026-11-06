import { ActionIcon, ColorSwatch, Group, Stack, Text, Tooltip } from "@mantine/core";
import { IconInfoCircle as InfoCircle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE } from "../../uiConstants";
import { formatPercent } from "../../util/formatCount";
import { toolbarLook } from "../common/toolbarLook";
import { calculateProbabiltyColor } from "./FaceComponent";

/** The thresholds of calculateProbabiltyColor, from the surest down. */
const STEPS = [0.9, 0.8, 0.7] as const;

/** What the coloured dot on a suggested face means, behind an ⓘ in the toolbar. */
export function ConfidenceLegend() {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const swatch = (probability: number) => (
    <ColorSwatch
      size={10}
      withShadow={false}
      color={`var(--mantine-color-${calculateProbabiltyColor(probability)}-filled)`}
    />
  );
  const lastStep = STEPS[STEPS.length - 1] ?? 0;

  const legend = (
    <Stack gap={4}>
      <Text size="xs" fw={600}>
        {t("facesdashboard.legendtitle")}
      </Text>
      {STEPS.map(step => (
        <Group key={step} gap={6} wrap="nowrap">
          {/* Just above the threshold, so the swatch has the colour of that band */}
          {swatch(step + 0.001)}
          <Text size="xs">{t("facesdashboard.legendover", { percent: formatPercent(step, locale, 0) })}</Text>
        </Group>
      ))}
      <Group gap={6} wrap="nowrap">
        {swatch(lastStep)}
        <Text size="xs">{t("facesdashboard.legendatmost", { percent: formatPercent(lastStep, locale, 0) })}</Text>
      </Group>
    </Stack>
  );

  return (
    <Tooltip label={legend} position="bottom-end" withArrow events={{ hover: true, focus: true, touch: true }}>
      <ActionIcon {...toolbarLook()} size={TOOLBAR_ACTION_SIZE} aria-label={t("facesdashboard.legendtitle")}>
        <InfoCircle size={ICON_SIZE.toolbar} />
      </ActionIcon>
    </Tooltip>
  );
}
