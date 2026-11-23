import { Group, Text } from "@mantine/core";
import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { EditSlider } from "../controls/EditSlider";
import { PixelCanvas } from "../controls/PixelCanvas";
import { useEditor } from "../EditorContext";
import { withControl } from "../engine/controls";
import { DEFAULT_RECIPE, type Recipe, type GradingWheel as Wheel } from "../engine/recipe";
import { onlySets, recipeAt } from "../state/session";
import classes from "./GradingWheel.module.css";
import { nudgeWheel, paintWheel, wheelPoint, wheelValue, type WheelValue } from "./wheelMath";

/** The disc's pixels (drawn at twice the CSS size for sharp screens), made once. */
const DISC_PIXELS = 240;
let disc: Uint8ClampedArray<ArrayBuffer> | null = null;
const discPixels = () => (disc ??= paintWheel(DISC_PIXELS));

type Props = Readonly<{ wheel: Wheel; name: string }>;

/** The recipe with a wheel's hue and amount. */
function withWheel(recipe: Recipe, wheel: Wheel, value: WheelValue): Recipe {
  return withControl(withControl(recipe, `grading.${wheel}.hue`, value.hue), `grading.${wheel}.sat`, value.sat);
}

/**
 * One colour grading wheel: drag the handle in the hue and amount disc (live, one step on release),
 * the arrow keys nudge it (left and right turn the hue, up and down the amount), a double click
 * resets the wheel; its hue and amount as numbers, and its luminance slider under it.
 */
export function GradingWheel({ wheel, name }: Props) {
  const { t } = useTranslation();
  const { session, commands } = useEditor();
  const area = useRef<HTMLDivElement>(null);
  const start = useRef<Recipe | null>(null);
  const pressedAt = useRef<number | null>(null);
  const value = session.recipe.grading[wheel];
  const handle = wheelPoint(value);
  const control = `grading.${wheel}.hue` as const;

  const valueAt = (event: React.PointerEvent): WheelValue | null => {
    const box = area.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    const radius = box.width / 2;
    return wheelValue({
      x: (event.clientX - box.left - radius) / radius,
      y: (box.top + radius - event.clientY) / radius,
    });
  };
  const show = (event: React.PointerEvent) => {
    const next = valueAt(event);
    if (next && start.current) commands.liveRecipe(control, withWheel(start.current, wheel, next));
  };

  return (
    <div className={classes.cell}>
      <Group justify="space-between" gap={4} wrap="nowrap">
        <Text size="sm">{name}</Text>
        <Text size="xs" c="dimmed" className={classes.readout}>
          {t("editor.grading.readout", { hue: value.hue, sat: value.sat })}
        </Text>
      </Group>
      <div
        ref={area}
        className={classes.wheel}
        role="slider"
        tabIndex={0}
        aria-label={t("editor.grading.wheel", { wheel: name })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value.sat}
        aria-valuetext={t("editor.grading.valueText", { hue: value.hue, sat: value.sat })}
        onPointerDown={event => {
          if (event.button !== 0) return;
          if (event.detail <= 1) pressedAt.current = session.cursor;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = session.recipe;
          show(event);
        }}
        onPointerMove={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) show(event);
        }}
        onPointerUp={() => {
          start.current = null;
          commands.commit();
        }}
        onPointerCancel={() => {
          start.current = null;
          commands.cancel();
        }}
        onDoubleClick={() => {
          // The double click's presses moved the handle: take those steps back before the reset.
          const from = pressedAt.current;
          pressedAt.current = null;
          const undo =
            from !== null && session.cursor > from && onlySets(session.history, from, session.cursor, control);
          if (undo) commands.goto(from);
          const recipe = undo ? recipeAt(session.history, from) : session.committed;
          commands.apply("reset", {
            ...recipe,
            grading: { ...recipe.grading, [wheel]: DEFAULT_RECIPE.grading[wheel] },
          });
        }}
        onKeyDown={event => {
          const next = nudgeWheel(value, event.key, event.shiftKey);
          if (!next) return;
          event.preventDefault();
          commands.liveRecipe(control, withWheel(session.recipe, wheel, next));
        }}
        onKeyUp={event => {
          if (event.key.startsWith("Arrow")) commands.commit();
        }}
      >
        <PixelCanvas pixels={discPixels()} width={DISC_PIXELS} height={DISC_PIXELS} className={classes.disc} />
        <svg className={classes.overlay} viewBox="-1 -1 2 2" aria-hidden>
          <circle cx={0} cy={0} r={0.02} className={classes.centre} />
          <line x1={0} y1={0} x2={handle.x} y2={-handle.y} className={classes.spoke} />
          <circle cx={handle.x} cy={-handle.y} r={0.09} className={classes.handle} />
        </svg>
      </div>
      <EditSlider
        path={`grading.${wheel}.lum`}
        label={t("editor.grading.luminance")}
        name={t("editor.grading.wheelLuminance", { wheel: name })}
      />
    </div>
  );
}
