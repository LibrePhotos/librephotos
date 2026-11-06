import { Group, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { formatPercent } from "../../util/formatCount";
import classes from "./ConfidenceLegend.module.css";
import { UNSURE_PROBABILITY } from "./FaceComponent";

/** What a faded suggestion means, in the toolbar's ⋯ menu: a sure face, then an unsure one. */
export function ConfidenceLegend() {
  const { t } = useTranslation();
  const percent = formatPercent(UNSURE_PROBABILITY, useFormatLocale(), 0);

  return (
    <Stack gap={4} px="sm" py={6}>
      <Text size="xs" fw={600}>
        {t("facesdashboard.legendtitle")}
      </Text>
      <Group gap={8} wrap="nowrap">
        <span className={classes.swatch} aria-hidden />
        <Text size="xs">{t("facesdashboard.legendover", { percent })}</Text>
      </Group>
      <Group gap={8} wrap="nowrap">
        <span className={classes.swatch} data-unsure aria-hidden />
        <Text size="xs">{t("facesdashboard.legendatmost", { percent })}</Text>
      </Group>
      <Text size="xs" c="dimmed">
        {t("facesdashboard.legendhover")}
      </Text>
    </Stack>
  );
}
