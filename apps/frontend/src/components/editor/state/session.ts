/**
 * The editing session as one reducer, without React: the recipe on screen, the history with its
 * cursor, a slider drag in progress ("live", one history step when it ends), and whether anything
 * differs from what was last saved. History semantics: apps/docs/docs/development/photo-editing.md,
 * "History".
 */
import type { EditHistoryAction, EditHistoryStep, PhotoEditUpdate } from "@librephotos/api-client";
import { readControl, withControl, type ControlPath, type ControlValue } from "../engine/controls";
import { DEFAULT_RECIPE, sameValue, toDense, toSparse, type Recipe } from "../engine/recipe";

/** At most this many steps are kept; a new step past it drops the oldest. */
export const HISTORY_LIMIT = 200;

export type EditSession = Readonly<{
  /** The recipe on screen: the step under the cursor, or a drag in progress. */
  recipe: Readonly<Recipe>;
  /** The recipe without the drag: the step under the cursor's (or the loaded one). */
  committed: Readonly<Recipe>;
  history: readonly EditHistoryStep[];
  /** The step whose recipe is current; -1 for the default recipe. */
  cursor: number;
  /** What a drag in progress becomes when it ends (one step); null while nothing is dragged. */
  live: LiveStep | null;
  /** What was last loaded or saved (see `fingerprint`), for `isDirty`. */
  saved: string;
}>;

/** The actions a step can record besides `set`, each with the recipe it leads to. */
export type ApplyKind = Exclude<EditHistoryAction, "set">;

/**
 * The step a drag in progress becomes: a `set` of the control being dragged (a slider), or an
 * applied step (the strength of a filter: a `preset` step with the filter's id).
 */
type LiveStep =
  Readonly<{ action: "set"; control: ControlPath }> | Readonly<{ action: ApplyKind; value: string | null }>;

function sameLive(a: LiveStep | null, b: LiveStep): boolean {
  if (a === null || a.action !== b.action) return false;
  if (a.action === "set" && b.action === "set") return a.control === b.control;
  return "value" in a && "value" in b && a.value === b.value;
}

export type SessionAction =
  /** Open an edit as the server sent it; it counts as saved. */
  | Readonly<{ type: "load"; edit: PhotoEditUpdate }>
  /** A control changed during a drag: shown at once, recorded when the drag ends. */
  | Readonly<{ type: "live"; control: ControlPath; recipe: Recipe; at: string }>
  /**
   * One control changed from the newest recipe (`change` computes it): `live` during a drag, `set`
   * for a change made at once. What controlAction builds, without reading a recipe that may be old.
   */
  | Readonly<{
      type: "change";
      control: ControlPath;
      phase: "live" | "set";
      change: (recipe: Recipe) => Recipe;
      at: string;
    }>
  /** An applied change during a drag (a filter's strength): shown at once, one step when it ends. */
  | Readonly<{ type: "liveApply"; action: ApplyKind; recipe: Recipe; value?: string; at: string }>
  /** The drag ended: its change becomes one `set` step (none when nothing changed). */
  | Readonly<{ type: "commit"; at: string }>
  /** The drag was abandoned (Escape): back to the step under the cursor. */
  | Readonly<{ type: "cancel" }>
  /** One control set at once (a toggle, a button, a typed value): one `set` step. */
  | Readonly<{ type: "set"; control: ControlPath; recipe: Recipe; at: string }>
  /**
   * A crop, preset, auto, paste, reset or import: one step to `recipe`; `value` is a preset's id. It
   * ends a drag in progress without a step of its own, so `recipe` should include that change (the
   * crop tool drags with `live` on `geometry.crop` and finishes with `apply` `crop`).
   */
  | Readonly<{ type: "apply"; action: ApplyKind; recipe: Recipe; value?: string; at: string }>
  | Readonly<{ type: "undo" }>
  | Readonly<{ type: "redo" }>
  /** Move the cursor to a step (-1: the default recipe) without adding one. */
  | Readonly<{ type: "goto"; index: number }>
  /** The server saved this state (what was sent, so changes made meanwhile stay dirty). */
  | Readonly<{ type: "saved"; edit: PhotoEditUpdate }>;

/** The recipe of the step at `index` (the default recipe for -1). */
function recipeAt(history: readonly EditHistoryStep[], index: number): Recipe {
  const step = history[index];
  return step ? toDense(step.settings) : DEFAULT_RECIPE;
}

/** What the server stores of a session: the recipe under the cursor, the history and the cursor. */
export function toServerEdit(session: EditSession): PhotoEditUpdate {
  return {
    settings: toSparse(session.committed),
    history: [...session.history],
    history_cursor: session.cursor,
  };
}

/** A comparable form of a saved state. */
function fingerprint(edit: PhotoEditUpdate): string {
  return JSON.stringify([toSparse(toDense(edit.settings)), edit.history, edit.history_cursor]);
}

/** A session opened on a server edit (the default when there is none). */
export function createSession(edit?: PhotoEditUpdate): EditSession {
  const opened = edit ?? { settings: { version: 1 }, history: [], history_cursor: -1 };
  const history = opened.history.slice(-HISTORY_LIMIT);
  const cursor = Math.min(Math.max(opened.history_cursor, -1), history.length - 1);
  const recipe = toDense(opened.settings);
  return {
    recipe,
    committed: recipe,
    history,
    cursor,
    live: null,
    saved: fingerprint({ settings: opened.settings, history, history_cursor: cursor }),
  };
}

/** Whether the session differs from what was last loaded or saved (a drag in progress counts). */
export function isDirty(session: EditSession): boolean {
  if (session.live !== null && !sameValue(session.recipe, session.committed)) return true;
  return fingerprint(toServerEdit(session)) !== session.saved;
}

export const canUndo = (session: EditSession) => session.live !== null || session.cursor >= 0;
export const canRedo = (session: EditSession) => session.cursor < session.history.length - 1;

/** A step's value: the control's new value when that is a number, boolean or string. */
function stepValue(recipe: Recipe, control: ControlPath): number | boolean | string | null {
  const value = readControl(recipe, control);
  return typeof value === "number" || typeof value === "boolean" || typeof value === "string" ? value : null;
}

/** Add a step after the cursor (dropping the steps after it, and the oldest past the limit). */
function pushStep(session: EditSession, step: EditHistoryStep, recipe: Recipe): EditSession {
  const kept = [...session.history.slice(0, session.cursor + 1), step].slice(-HISTORY_LIMIT);
  return { ...session, recipe, committed: recipe, history: kept, cursor: kept.length - 1, live: null };
}

/** Record `recipe` as a step, unless it is the recipe under the cursor already. */
function record(session: EditSession, recipe: Recipe, step: Omit<EditHistoryStep, "settings">): EditSession {
  if (sameValue(recipe, session.committed)) return { ...session, recipe: session.committed, live: null };
  return pushStep(session, { ...step, settings: toSparse(recipe) }, recipe);
}

/** End a drag in progress: its change becomes one step. */
function commitLive(session: EditSession, at: string): EditSession {
  const live = session.live;
  if (live === null) return session;
  if (live.action === "set") {
    const { control } = live;
    return record(session, session.recipe, { action: "set", control, value: stepValue(session.recipe, control), at });
  }
  return record(session, session.recipe, { action: live.action, value: live.value, at });
}

/** Show a change of a drag; a drag of something else ends first (its own step). */
function goLive(session: EditSession, live: LiveStep, recipe: Recipe, at: string): EditSession {
  const settled = session.live !== null && !sameLive(session.live, live) ? commitLive(session, at) : session;
  return { ...settled, recipe, live };
}

function move(session: EditSession, cursor: number): EditSession {
  const index = Math.min(Math.max(cursor, -1), session.history.length - 1);
  const recipe = recipeAt(session.history, index);
  return { ...session, cursor: index, recipe, committed: recipe, live: null };
}

export function sessionReducer(session: EditSession, action: SessionAction): EditSession {
  switch (action.type) {
    case "load":
      return createSession(action.edit);
    case "live":
      return goLive(session, { action: "set", control: action.control }, action.recipe, action.at);
    case "change":
      return sessionReducer(session, {
        type: action.phase,
        control: action.control,
        recipe: action.change(session.recipe),
        at: action.at,
      });
    case "liveApply":
      return goLive(session, { action: action.action, value: action.value ?? null }, action.recipe, action.at);
    case "commit":
      return commitLive(session, action.at);
    case "cancel":
      return { ...session, recipe: session.committed, live: null };
    case "set": {
      const settled = commitLive(session, action.at);
      const value = stepValue(action.recipe, action.control);
      return record(settled, action.recipe, { action: "set", control: action.control, value, at: action.at });
    }
    case "apply":
      // A drag in progress (the crop tool's frame, say) is part of this step, not one of its own.
      return record(session, action.recipe, { action: action.action, value: action.value ?? null, at: action.at });
    case "undo":
      return session.live !== null
        ? { ...session, recipe: session.committed, live: null }
        : move(session, session.cursor - 1);
    case "redo":
      return session.live !== null ? session : move(session, session.cursor + 1);
    case "goto":
      return move(session, action.index);
    case "saved":
      return { ...session, saved: fingerprint(action.edit) };
  }
}

/** The action for a change of one control: `live` while dragging, `set` for a change made at once. */
export function controlAction<P extends ControlPath>(
  session: EditSession,
  control: P,
  value: ControlValue<P>,
  phase: "live" | "set",
  at: string
): SessionAction {
  return { type: phase, control, recipe: withControl(session.recipe, control, value), at };
}
