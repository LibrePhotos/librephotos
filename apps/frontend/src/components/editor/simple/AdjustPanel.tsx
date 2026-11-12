import { Button, Group, Stack } from "@mantine/core";
import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { EditSlider } from "../controls/EditSlider";
import { anyChanged, withDefaults } from "../controls/resetControls";
import type { SliderRange } from "../controls/sliderSpec";
import { useEditor } from "../EditorContext";
import type { NumberControlPath } from "../engine/controls";

type SimpleControl = Readonly<{ path: NumberControlPath; label: ParseKeys; range?: SliderRange }>;

/** Brightness is Exposure, about two stops each way here; the advanced mode has all five. */
const BRIGHTNESS_RANGE: SliderRange = { min: -2, max: 2 };

/** The simple mode's controls, in plain words. */
const SIMPLE_CONTROLS: readonly SimpleControl[] = [
  { path: "light.exposure", label: "editor.simple.brightness", range: BRIGHTNESS_RANGE },
  { path: "light.contrast", label: "editor.simple.contrast" },
  { path: "light.highlights", label: "editor.simple.highlights" },
  { path: "light.shadows", label: "editor.simple.shadows" },
  { path: "color.saturation", label: "editor.simple.saturation" },
  { path: "wb.temp", label: "editor.simple.warmth" },
  { path: "wb.tint", label: "editor.simple.tint" },
  { path: "detail.sharpen_amount", label: "editor.simple.sharpness" },
  { path: "vignette.amount", label: "editor.simple.vignette" },
];

const PATHS = SIMPLE_CONTROLS.map(control => control.path);

/** The Adjust tab: nine sliders and a reset for all of them (one step). */
export function AdjustPanel() {
  const { t } = useTranslation();
  const { session, commands } = useEditor();
  return (
    <Stack gap={4}>
      {SIMPLE_CONTROLS.map(control => (
        <EditSlider key={control.path} path={control.path} label={t(control.label)} range={control.range} />
      ))}
      {anyChanged(session.recipe, PATHS) && (
        <Group justify="flex-end" mt="xs">
          <Button
            size="compact-sm"
            variant="subtle"
            color="gray"
            onClick={() => commands.apply("reset", withDefaults(session.recipe, PATHS))}
          >
            {t("editor.simple.resetAdjustments")}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
