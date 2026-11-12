import { SimpleGrid, Stack } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { GRADING_WHEELS, WHEEL_LABELS } from "../color/colorLabels";
import { EditSlider } from "../controls/EditSlider";
import { GradingWheel } from "./GradingWheel";

/** The Color grading section: the four wheels, then Blending and Balance. */
export function GradingPanel() {
  const { t } = useTranslation();
  return (
    <Stack gap="sm">
      <SimpleGrid cols={2} spacing="md" verticalSpacing="sm">
        {GRADING_WHEELS.map(wheel => (
          <GradingWheel key={wheel} wheel={wheel} name={t(WHEEL_LABELS[wheel])} />
        ))}
      </SimpleGrid>
      <Stack gap={4}>
        <EditSlider path="grading.blending" label={t("editor.grading.blending")} />
        <EditSlider path="grading.balance" label={t("editor.grading.balance")} />
      </Stack>
    </Stack>
  );
}
