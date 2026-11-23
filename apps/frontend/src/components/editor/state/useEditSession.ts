import type { PhotoEditUpdate } from "@librephotos/api-client";
import { useCallback, useMemo, useReducer } from "react";
import { withControl, type ControlPath, type ControlValue } from "../engine/controls";
import type { Recipe } from "../engine/recipe";
import { createSession, sessionReducer, type ApplyKind, type EditSession } from "./session";

/** A history step's time: now, as the server stores it. */
const now = () => new Date().toISOString();

/**
 * What changes the session, each one dispatch. Stable across renders: panels and sliders can keep
 * them in effects and memoised handlers.
 */
export type SessionCommands = Readonly<{
  /** A control during a drag (`live`, one step when the drag ends) or set at once (`set`, one step). */
  setControl: <P extends ControlPath>(control: P, value: ControlValue<P>, phase: "live" | "set") => void;
  /** A drag of `control` whose change is more than that control (straighten shrinks the crop). */
  liveRecipe: (control: ControlPath, recipe: Recipe) => void;
  /** A change of `control` made at once whose recipe is more than that control (an aspect lock). */
  setRecipe: (control: ControlPath, recipe: Recipe) => void;
  /** A drag whose end is an applied step (a filter's strength). */
  liveApply: (action: ApplyKind, recipe: Recipe, value?: string) => void;
  /** The drag ended: its change becomes one step. */
  commit: () => void;
  /** The drag is abandoned. */
  cancel: () => void;
  /** One step of a crop, preset, auto, paste, reset or import. */
  apply: (action: ApplyKind, recipe: Recipe, value?: string) => void;
  undo: () => void;
  redo: () => void;
  goto: (index: number) => void;
  /** The server saved this state. */
  saved: (edit: PhotoEditUpdate) => void;
}>;

/** The editing session of one photo, opened on the edit the server sent. */
export function useEditSession(edit: PhotoEditUpdate): [EditSession, SessionCommands] {
  const [session, dispatch] = useReducer(sessionReducer, edit, createSession);
  const setControl = useCallback(
    <P extends ControlPath>(control: P, value: ControlValue<P>, phase: "live" | "set") =>
      // Set on the newest recipe, so two changes between renders both count.
      dispatch({ type: "change", control, phase, change: recipe => withControl(recipe, control, value), at: now() }),
    []
  );
  const commands = useMemo<SessionCommands>(
    () => ({
      setControl,
      liveRecipe: (control, recipe) => dispatch({ type: "live", control, recipe, at: now() }),
      setRecipe: (control, recipe) => dispatch({ type: "set", control, recipe, at: now() }),
      liveApply: (action, recipe, value) => dispatch({ type: "liveApply", action, recipe, value, at: now() }),
      commit: () => dispatch({ type: "commit", at: now() }),
      cancel: () => dispatch({ type: "cancel" }),
      apply: (action, recipe, value) => dispatch({ type: "apply", action, recipe, value, at: now() }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
      goto: index => dispatch({ type: "goto", index }),
      saved: saved => dispatch({ type: "saved", edit: saved }),
    }),
    [setControl]
  );
  return [session, commands];
}
