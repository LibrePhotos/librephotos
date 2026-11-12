import type { PhotoEditUpdate } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { withControl } from "../engine/controls";
import { DEFAULT_RECIPE } from "../engine/recipe";
import {
  canRedo,
  canUndo,
  controlAction,
  createSession,
  HISTORY_LIMIT,
  isDirty,
  sessionReducer,
  toServerEdit,
  type EditSession,
  type SessionAction,
} from "./session";
import { stepLabel } from "./stepLabel";

const AT = "2026-11-12T09:30:00Z";

function run(session: EditSession, ...actions: SessionAction[]): EditSession {
  return actions.reduce(sessionReducer, session);
}

const exposure = (session: EditSession, value: number, phase: "live" | "set" = "set") =>
  controlAction(session, "light.exposure", value, phase, AT);

/** A drag of exposure through `values`, released at the end. */
function drag(session: EditSession, values: number[]): EditSession {
  let next = session;
  for (const value of values) next = sessionReducer(next, exposure(next, value, "live"));
  return sessionReducer(next, { type: "commit", at: AT });
}

describe("editing session", () => {
  it("starts on the default recipe with no history, clean", () => {
    const session = createSession();
    expect(session.recipe).toEqual(DEFAULT_RECIPE);
    expect(session.cursor).toBe(-1);
    expect(isDirty(session)).toBe(false);
    expect(canUndo(session)).toBe(false);
  });

  it("records a drag as one step, shown live while it lasts", () => {
    const start = createSession();
    const moving = sessionReducer(start, exposure(start, 0.2, "live"));
    expect(moving.recipe.light.exposure).toBe(0.2);
    expect(moving.history).toHaveLength(0);
    expect(isDirty(moving)).toBe(true);
    const done = drag(start, [0.1, 0.2, 0.35]);
    expect(done.history).toHaveLength(1);
    expect(defined(done.history[0])).toEqual({
      action: "set",
      control: "light.exposure",
      value: 0.35,
      at: AT,
      settings: { version: 1, light: { exposure: 0.35 } },
    });
    expect(done.cursor).toBe(0);
    expect(done.live).toBeNull();
  });

  it("makes two steps of two releases of the same control, and none of a drag back to the start", () => {
    const twice = drag(drag(createSession(), [0.2]), [0.4]);
    expect(twice.history).toHaveLength(2);
    expect(drag(createSession(), [0.3, 0])).toEqual(createSession());
  });

  it("commits a drag when another control starts moving", () => {
    let session = sessionReducer(createSession(), exposure(createSession(), 1, "live"));
    session = sessionReducer(session, controlAction(session, "light.contrast", 20, "live", AT));
    session = sessionReducer(session, { type: "commit", at: AT });
    expect(session.history.map(step => step.control)).toEqual(["light.exposure", "light.contrast"]);
    expect(session.recipe.light).toMatchObject({ exposure: 1, contrast: 20 });
  });

  it("undoes, redoes and goes to a step without adding one", () => {
    const three = drag(drag(drag(createSession(), [1]), [2]), [3]);
    const undone = run(three, { type: "undo" }, { type: "undo" });
    expect(undone.cursor).toBe(0);
    expect(undone.recipe.light.exposure).toBe(1);
    expect(undone.history).toHaveLength(3);
    expect(canRedo(undone)).toBe(true);
    expect(run(undone, { type: "redo" }).recipe.light.exposure).toBe(2);
    expect(run(three, { type: "goto", index: -1 }).recipe).toEqual(DEFAULT_RECIPE);
    expect(run(three, { type: "goto", index: 1 }).recipe.light.exposure).toBe(2);
    expect(run(three, { type: "goto", index: 9 }).cursor).toBe(2);
    expect(run(three, { type: "undo" }, { type: "undo" }, { type: "undo" }, { type: "undo" }).cursor).toBe(-1);
  });

  it("drops the steps after the cursor on a new edit", () => {
    const three = drag(drag(drag(createSession(), [1]), [2]), [3]);
    const branched = drag(run(three, { type: "goto", index: 0 }), [-1]);
    expect(branched.history.map(step => step.value)).toEqual([1, -1]);
    expect(branched.cursor).toBe(1);
    expect(canRedo(branched)).toBe(false);
  });

  it("undoes a drag in progress first, and cancels one", () => {
    const one = drag(createSession(), [1]);
    const moving = sessionReducer(one, exposure(one, 4, "live"));
    expect(run(moving, { type: "undo" }).recipe.light.exposure).toBe(1);
    expect(run(moving, { type: "undo" }).cursor).toBe(0);
    expect(run(moving, { type: "cancel" }).recipe.light.exposure).toBe(1);
  });

  it("keeps at most 200 steps, dropping the oldest", () => {
    let session = createSession();
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) session = sessionReducer(session, exposure(session, i / 100));
    expect(session.history).toHaveLength(HISTORY_LIMIT);
    expect(defined(session.history[0]).value).toBe(0.06);
    expect(session.cursor).toBe(HISTORY_LIMIT - 1);
  });

  it("records presets, crops and resets with their action", () => {
    const preset = withControl(DEFAULT_RECIPE, "color.treatment", "bw");
    let session = run(createSession(), { type: "apply", action: "preset", value: "mono", recipe: preset, at: AT });
    session = run(session, { type: "apply", action: "reset", recipe: DEFAULT_RECIPE, at: AT });
    expect(session.history.map(step => [step.action, step.value])).toEqual([
      ["preset", "mono"],
      ["reset", null],
    ]);
    expect(session.recipe).toEqual(DEFAULT_RECIPE);
  });

  it("makes a crop drag one crop step", () => {
    const start = createSession();
    const crop = { cx: 0.5, cy: 0.5, w: 0.6, h: 0.6 };
    const moving = sessionReducer(start, controlAction(start, "geometry.crop", crop, "live", AT));
    const done = sessionReducer(moving, { type: "apply", action: "crop", recipe: moving.recipe, at: AT });
    expect(done.history.map(step => step.action)).toEqual(["crop"]);
    expect(done.recipe.geometry.crop).toEqual(crop);
    expect(done.live).toBeNull();
  });

  it("converts to and from the server shape and tracks what was saved", () => {
    const edited = drag(createSession(), [0.5]);
    const sent = toServerEdit(edited);
    expect(sent).toMatchObject({ settings: { version: 1, light: { exposure: 0.5 } }, history_cursor: 0 });
    expect(isDirty(edited)).toBe(true);
    const saved = sessionReducer(edited, { type: "saved", edit: sent });
    expect(isDirty(saved)).toBe(false);
    expect(isDirty(run(saved, { type: "undo" }))).toBe(true);

    const reopened = createSession(sent);
    expect(reopened.recipe.light.exposure).toBe(0.5);
    expect(isDirty(reopened)).toBe(false);
    const loaded: PhotoEditUpdate = { ...sent, history_cursor: 5 };
    expect(run(createSession(), { type: "load", edit: loaded }).cursor).toBe(0);
  });

  it("labels a step by its action, control and value", () => {
    const session = drag(createSession(), [0.35]);
    expect(stepLabel(defined(session.history[0]))).toEqual({
      kind: "set",
      control: "light.exposure",
      group: "light",
      value: 0.35,
    });
    const step = { action: "set", control: "light.brilliance", value: 1, at: AT, settings: { version: 1 } } as const;
    expect(stepLabel(step)).toEqual({ kind: "unknown" });
    expect(stepLabel({ ...step, action: "preset", control: null, value: "mono" })).toEqual({
      kind: "preset",
      preset: "mono",
    });
    expect(stepLabel({ ...step, action: "crop" })).toEqual({ kind: "crop" });
  });

  it("makes one preset step of a strength drag, and a change from the newest recipe", () => {
    const start = createSession();
    const at = (amount: number) => withControl(DEFAULT_RECIPE, "light.contrast", amount);
    let session = run(
      start,
      { type: "liveApply", action: "preset", recipe: at(10), value: "punch", at: AT },
      { type: "liveApply", action: "preset", recipe: at(30), value: "punch", at: AT },
      { type: "commit", at: AT }
    );
    expect(session.history).toHaveLength(1);
    expect(session.history[0]).toMatchObject({ action: "preset", value: "punch" });
    expect(session.recipe.light.contrast).toBe(30);

    session = run(
      session,
      {
        type: "change",
        control: "light.exposure",
        phase: "set",
        change: recipe => withControl(recipe, "light.exposure", 1),
        at: AT,
      },
      {
        type: "change",
        control: "light.exposure",
        phase: "set",
        change: recipe => withControl(recipe, "light.exposure", recipe.light.exposure + 1),
        at: AT,
      }
    );
    expect(session.recipe.light.exposure).toBe(2);
    expect(session.history).toHaveLength(3);
  });
});
