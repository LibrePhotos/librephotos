import type { EditAspect } from "@librephotos/api-client";
import { ActionIcon, Button, Group, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconArrowsExchange,
  IconFlipHorizontal,
  IconFlipVertical,
  IconRotate2,
  IconRotateClockwise2,
} from "@tabler/icons-react";
import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../../uiConstants";
import { DisabledReason } from "../../common/DisabledReason";
import { sliderSpec } from "../controls/sliderSpec";
import { ValueSlider } from "../controls/ValueSlider";
import { useEditor } from "../EditorContext";
import type { GeometrySettings, Recipe } from "../engine/recipe";
import { withAspect, withStraighten } from "./cropDrag";
import { invertAspect, mirror, turnQuarter } from "./quarterTurn";

/** The aspect choices, each in its landscape-or-square form; the swap button turns it round. */
const ASPECTS: readonly (EditAspect | null)[] = [null, "original", "1:1", "5:4", "7:5", "3:2", "4:3", "16:9", "16:10"];

const STRAIGHTEN = sliderSpec("geometry.straighten");

/** The choice an aspect lock belongs to: itself, or the listed ratio it is the inverse of. */
function choiceOf(aspect: EditAspect | null): EditAspect | null {
  return ASPECTS.includes(aspect) ? aspect : invertAspect(aspect);
}

/**
 * The crop tool's controls: the aspect lock (free, the photo's own, the usual ratios) and its swap,
 * Straighten (the crop shrinks where the turned picture no longer holds it), the quarter turns and
 * the mirrors. Each is one history step.
 */
export function CropControls() {
  const { t } = useTranslation();
  const { session, commands, sourceSize } = useEditor();
  const recipe = session.recipe;
  const geometry = recipe.geometry;
  const withGeometry = (next: GeometrySettings): Recipe => ({ ...recipe, geometry: next });
  // A straighten drag shrinks the crop from where the drag began, so dragging back restores it.
  const straightenFrom = useRef<GeometrySettings | null>(null);
  const straighten = (degrees: number, phase: "live" | "set") => {
    const from = straightenFrom.current ?? geometry;
    if (phase === "live") straightenFrom.current = from;
    const next = withGeometry(withStraighten(from, degrees, sourceSize));
    if (phase === "live") commands.liveRecipe("geometry.straighten", next);
    else commands.setRecipe("geometry.straighten", next);
  };

  const chosen = choiceOf(geometry.aspect);
  const swappable = geometry.aspect !== invertAspect(geometry.aspect);
  const aspectLabel = (aspect: EditAspect | null) =>
    aspect === null ? t("editor.crop.free") : aspect === "original" ? t("editor.crop.original") : aspect;
  const swapLabel = t("editor.crop.swap");
  const quarter = (direction: "left" | "right") =>
    commands.setRecipe("geometry.orientation", withGeometry(turnQuarter(geometry, direction)));
  const flip = (axis: "horizontal" | "vertical") =>
    commands.setRecipe(
      axis === "horizontal" ? "geometry.flip_h" : "geometry.flip_v",
      withGeometry(mirror(geometry, axis))
    );

  return (
    <Stack gap="md">
      <div>
        <Group justify="space-between" mb={6}>
          <Text size="sm">{t("editor.crop.aspect")}</Text>
          <DisabledReason reason={!swappable && t("editor.crop.swapUnavailable")} label={swapLabel}>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={swapLabel}
              onClick={() =>
                commands.setRecipe(
                  "geometry.aspect",
                  withGeometry(withAspect(geometry, invertAspect(geometry.aspect), sourceSize))
                )
              }
            >
              <IconArrowsExchange size={ICON_SIZE.menu} />
            </ActionIcon>
          </DisabledReason>
        </Group>
        <SimpleGrid cols={3} spacing={6} verticalSpacing={6}>
          {ASPECTS.map(aspect => (
            <Button
              key={aspect ?? "free"}
              size="compact-sm"
              variant={chosen === aspect ? "filled" : "default"}
              aria-pressed={chosen === aspect}
              onClick={() =>
                commands.setRecipe("geometry.aspect", withGeometry(withAspect(geometry, aspect, sourceSize)))
              }
            >
              {aspectLabel(aspect === chosen ? geometry.aspect : aspect)}
            </Button>
          ))}
        </SimpleGrid>
      </div>
      <ValueSlider
        label={t("editor.crop.straighten")}
        spec={STRAIGHTEN}
        value={geometry.straighten}
        unit="°"
        onLive={degrees => straighten(degrees, "live")}
        onCommit={() => {
          straightenFrom.current = null;
          commands.commit();
        }}
        onSet={degrees => straighten(degrees, "set")}
        onReset={() => straighten(0, "set")}
      />
      <Group gap="xs" justify="space-between">
        <Text size="sm">{t("editor.crop.rotateFlip")}</Text>
        <Group gap={4}>
          <CropButton
            label={t("editor.crop.rotateLeft")}
            onClick={() => quarter("left")}
            icon={<IconRotate2 size={ICON_SIZE.menu} />}
          />
          <CropButton
            label={t("editor.crop.rotateRight")}
            onClick={() => quarter("right")}
            icon={<IconRotateClockwise2 size={ICON_SIZE.menu} />}
          />
          <CropButton
            label={t("editor.crop.flipHorizontal")}
            onClick={() => flip("horizontal")}
            icon={<IconFlipHorizontal size={ICON_SIZE.menu} />}
          />
          <CropButton
            label={t("editor.crop.flipVertical")}
            onClick={() => flip("vertical")}
            icon={<IconFlipVertical size={ICON_SIZE.menu} />}
          />
        </Group>
      </Group>
    </Stack>
  );
}

function CropButton({ label, onClick, icon }: Readonly<{ label: string; onClick: () => void; icon: React.ReactNode }>) {
  return (
    <Tooltip label={label}>
      <ActionIcon variant="default" size="lg" aria-label={label} onClick={onClick}>
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}
