import type { EditHistoryStep } from "@librephotos/api-client";
import React, { useMemo, useRef } from "react";
import { useEditor } from "../EditorContext";
import { numberControl, readNumber, type NumberControlPath } from "../engine/controls";
import { sliderSpec, type SliderRange } from "./sliderSpec";
import { ValueSlider } from "./ValueSlider";

export type EditSliderProps = Readonly<{
  /** The number control it sets (engine/controls.ts): its range, default and step come from there. */
  path: NumberControlPath;
  /** The control's name, translated. */
  label: string;
  /** A narrower range than the control's (the simple mode's Brightness is about two stops each way). */
  range?: SliderRange;
}>;

/** Whether the steps after `from` up to `to` all set `control` (what a double click's first press made). */
function onlySets(history: readonly EditHistoryStep[], from: number, to: number, control: NumberControlPath): boolean {
  return history.slice(from + 1, to + 1).every(step => step.action === "set" && step.control === control);
}

/**
 * A slider bound to one number control of the session: drag is live and one step on release, a key
 * press or a typed value one step, a double click resets the control to its default in one step.
 */
export function EditSlider({ path, label, range }: EditSliderProps) {
  const { session, commands } = useEditor();
  const min = range?.min;
  const max = range?.max;
  const spec = useMemo(
    () => sliderSpec(path, min === undefined || max === undefined ? undefined : { min, max }),
    [path, min, max]
  );
  const pressedAt = useRef<number | null>(null);
  const reset = () => {
    const from = pressedAt.current;
    pressedAt.current = null;
    // The double click's first press jumped the handle to the pointer: take that back first.
    if (from !== null && session.cursor > from && onlySets(session.history, from, session.cursor, path)) {
      commands.goto(from);
    }
    commands.setControl(path, numberControl(path).default, "set");
  };
  return (
    <ValueSlider
      label={label}
      spec={spec}
      value={readNumber(session.recipe, path)}
      onLive={value => commands.setControl(path, value, "live")}
      onCommit={commands.commit}
      onSet={value => commands.setControl(path, value, "set")}
      onReset={reset}
      onPressStart={() => {
        pressedAt.current = session.cursor;
      }}
    />
  );
}
