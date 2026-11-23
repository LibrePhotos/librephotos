import { Button, Group, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import classes from "./EditorStage.module.css";
import type { DrawnFrame } from "./usePreview";
import { FIT, zoomAround, zoomPercent, type ZoomState } from "./viewMath";

type Props = Readonly<{ drawn: DrawnFrame; onZoom: (zoom: ZoomState) => void }>;

/** The zoom in the canvas's corner: its percentage, Fit and 100 %. */
export function ZoomReadout({ drawn, onZoom }: Props) {
  const { t } = useTranslation();
  const centre = { x: drawn.canvas.width / 2, y: drawn.canvas.height / 2 };
  return (
    <Group gap={4} className={classes.zoom} wrap="nowrap">
      <Text size="xs" className={classes.percent} aria-live="polite">
        {t("editor.zoom.percent", { percent: zoomPercent(drawn.view) })}
      </Text>
      <Button size="compact-xs" variant="subtle" color="gray" onClick={() => onZoom(FIT)}>
        {t("editor.zoom.fit")}
      </Button>
      <Button
        size="compact-xs"
        variant="subtle"
        color="gray"
        onClick={() =>
          onZoom({ kind: "manual", view: zoomAround(drawn.view, 1, centre, drawn.canvas, drawn.picture, drawn.margin) })
        }
      >
        {t("editor.zoom.actual")}
      </Button>
    </Group>
  );
}
