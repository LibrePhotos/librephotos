/**
 * The settings forms kept a local copy of the server's values and an effect copied the server's
 * over it on every fetch: a refetch threw away what was being typed, a switch sent the opposite of
 * a stale copy (two quick clicks sent the same value), and a save had no state of its own.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../util/defined.test-utils";
import { draftReducer, useServerDraft, type DraftState } from "./useServerDraft";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

type Draft = ReturnType<typeof useServerDraft<string>>;

/** A save the test settles by hand, one per call. */
function manualSave() {
  const calls: Array<{ value: string; settle: (saved: boolean) => void }> = [];
  const save = vi.fn(
    (value: string) =>
      new Promise<boolean>(resolve => {
        calls.push({ value, settle: resolve });
      })
  );
  return { save, calls };
}

let root: Root | undefined;

afterEach(async () => {
  const mounted = root;
  root = undefined;
  if (mounted) await act(async () => mounted.unmount());
});

async function renderDraft(
  server: string,
  save: (value: string) => Promise<boolean>,
  keepOnFailure = false
): Promise<{ current: () => Draft; rerender: (server: string) => Promise<void> }> {
  let latest: Draft | undefined;
  function Probe({ value }: { value: string }) {
    latest = useServerDraft(value, { save, keepOnFailure });
    return null;
  }
  const mounted = createRoot(document.createElement("div"));
  root = mounted;
  await act(async () => mounted.render(<Probe value={server} />));
  return {
    current: () => defined(latest),
    rerender: async next => act(async () => mounted.render(<Probe value={next} />)),
  };
}

describe("useServerDraft", () => {
  it("follows the server while nothing is edited", async () => {
    const draft = await renderDraft("a", manualSave().save);
    await draft.rerender("b");
    expect(draft.current().value).toBe("b");
    expect(draft.current().status).toBe("clean");
  });

  it("keeps a draft when the server's value is fetched again", async () => {
    const draft = await renderDraft("a", manualSave().save);
    await act(async () => draft.current().edit("typed"));
    await draft.rerender("from another tab");
    expect(draft.current().value).toBe("typed");
    expect(draft.current().dirty).toBe(true);
  });

  it("sends nothing for an unchanged value", async () => {
    const { save } = manualSave();
    const draft = await renderDraft("a", save);
    await act(async () => draft.current().edit("a"));
    let saved: boolean | undefined;
    await act(async () => {
      saved = await draft.current().commit();
    });
    expect(save).not.toHaveBeenCalled();
    expect(saved).toBe(true);
    expect(draft.current().status).toBe("clean");
  });

  it("sends each of two quick changes, and only the newer one settles the draft", async () => {
    const { save, calls } = manualSave();
    const draft = await renderDraft("off", save);
    await act(async () => void draft.current().commit("on"));
    // Back to the server's value while the first save runs: it is sent too, as the server may hold "on" by now.
    await act(async () => void draft.current().commit("off"));
    expect(calls.map(call => call.value)).toEqual(["on", "off"]);

    await act(async () => defined(calls[0]).settle(true));
    expect(draft.current()).toMatchObject({ status: "saving", value: "off" });
    await act(async () => defined(calls[1]).settle(true));
    expect(draft.current().status).toBe("clean");
  });

  it("shows the server's value again after a refused save", async () => {
    const { save, calls } = manualSave();
    const draft = await renderDraft("a", save);
    await act(async () => void draft.current().commit("b"));
    expect(draft.current()).toMatchObject({ status: "saving", value: "b" });
    await act(async () => defined(calls[0]).settle(false));
    expect(draft.current()).toMatchObject({ status: "clean", value: "a" });
  });

  it("keeps the draft to fix when asked to", async () => {
    const { save, calls } = manualSave();
    const draft = await renderDraft("a", save, true);
    await act(async () => void draft.current().commit("b"));
    await act(async () => defined(calls[0]).settle(false));
    expect(draft.current()).toMatchObject({ status: "editing", value: "b", dirty: true });
  });
});

describe("draftReducer", () => {
  it("ignores a save that settles after the draft was edited again", () => {
    const saving: DraftState<string> = { status: "saving", draft: "b", seq: 1 };
    const edited = draftReducer(saving, { type: "edit", draft: "c" });
    expect(draftReducer(edited, { type: "settled", seq: 1, outcome: "saved" })).toEqual({
      status: "editing",
      draft: "c",
    });
  });
});
