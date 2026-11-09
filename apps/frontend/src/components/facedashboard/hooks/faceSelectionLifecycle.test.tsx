/**
 * The faces dashboard's selection and the faces' pending state (#599):
 * - the toolbar's Delete, Restore and Not this person cleared the selection when they sent the
 *   request, so a failure lost it; now the faces leave the selection once the server took them;
 * - the selection survived a change of person, group, method or order filter, so an action could
 *   hit faces no longer on screen; it is now tied to the list it was made in;
 * - a face stayed dimmed after a successful action that kept it on screen (labelled to another
 *   person on the same tab);
 * - the tab's scroll request was dropped only when the grid reached exactly the saved position.
 */
import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import type { FacesTab } from "../facesTab";
import { useFaceActions } from "./useFaceActions";
import { useFaceSelection } from "./useFaceSelection";
import { useSelectedFaceActions } from "./useSelectedFaceActions";
import { useTabScrollRequest } from "./useTabScrollRequest";
import type { FaceCell, GridCell } from "./useVirtualizedGrid";

type Callbacks = { onSuccess?: () => void; onError?: () => void };
type Sent = { request: unknown; callbacks: Callbacks };

const sent = vi.hoisted(() => [] as Sent[]);

vi.mock("../../../api_client/faces", () => {
  const mutation = () => ({
    mutate: (request: unknown, callbacks: Callbacks = {}) => sent.push({ request, callbacks }),
  });
  return {
    useDeleteFacesMutation: mutation,
    useRestoreFacesMutation: mutation,
    useSetFacesPersonLabelMutation: mutation,
  };
});

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const unmounts: (() => void)[] = [];
afterEach(() => {
  while (unmounts.length) defined(unmounts.pop())();
  sent.length = 0;
});

/** Renders a hook; `current()` is its latest result, `rerender` gives it new arguments. */
async function renderHook<Args, Result>(useHook: (args: Args) => Result, initial: Args) {
  let latest: { value: Result } | undefined;
  let args = initial;
  function Host() {
    latest = { value: useHook(args) };
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Host />));
  unmounts.push(() => act(() => root.unmount()));
  return {
    current: () => defined(latest).value,
    rerender: async (next: Args) => {
      args = next;
      await act(async () => root.render(<Host />));
    },
  };
}

const face = (id: number): FaceCell => ({ id, image: `/${id}.jpg`, face_url: `/${id}.jpg`, photo: "p" });
const noRange = (): GridCell[] => [];
const click = { shiftKey: false };

/** The dashboard's wiring: the selection, the faces' pending state and the toolbar's actions. */
function useDashboard(scope: string) {
  const selection = useFaceSelection(noRange, scope);
  const faceActions = useFaceActions();
  const actions = useSelectedFaceActions(selection.selectedFaces, selection.dropFaces, faceActions.track);
  return { selection, faceActions, actions };
}

async function selectTwo(scope = "labeled") {
  const hook = await renderHook(useDashboard, scope);
  await act(async () => hook.current().selection.handleCellClick(click, face(1)));
  await act(async () => hook.current().selection.handleCellClick(click, face(2)));
  return hook;
}

const selectedIds = (hook: Awaited<ReturnType<typeof selectTwo>>) =>
  hook.current().selection.selectedFaces.map(selected => selected.face_id);

describe("the selected faces' actions", () => {
  it("keep the selection when the server refuses, and the faces get their buttons back", async () => {
    const hook = await selectTwo();
    await act(async () => hook.current().actions.deleteSelected());

    expect(defined(sent[0]).request).toEqual({ faceIds: [1, 2] });
    expect([...hook.current().faceActions.pendingFaceIds]).toEqual([1, 2]);
    expect(selectedIds(hook)).toEqual([1, 2]);

    await act(async () => defined(sent[0]).callbacks.onError?.());
    expect(selectedIds(hook)).toEqual([1, 2]);
    expect(hook.current().faceActions.pendingFaceIds.size).toBe(0);
  });

  it("drop the faces from the selection once the server took them", async () => {
    const hook = await selectTwo();
    await act(async () => hook.current().actions.rejectSelected());
    expect(defined(sent[0]).request).toEqual({ faceIds: [1, 2], personName: UNKNOWN_PERSON_NAME });

    // A face picked while the request ran stays selected
    await act(async () => hook.current().selection.handleCellClick(click, face(3)));
    await act(async () => defined(sent[0]).callbacks.onSuccess?.());
    expect(selectedIds(hook)).toEqual([3]);
    expect(hook.current().faceActions.pendingFaceIds.size).toBe(0);
  });

  it("labels a cluster's faces without touching the selection", async () => {
    const hook = await selectTwo();
    await act(async () => hook.current().actions.label([{ face_id: 7, face_url: null }], "Anna"));
    await act(async () => defined(sent[0]).callbacks.onSuccess?.());

    expect(defined(sent[0]).request).toEqual({ faceIds: [7], personName: "Anna" });
    expect(selectedIds(hook)).toEqual([1, 2]);
  });
});

describe("the face selection", () => {
  it("does not outlive the list it was made in, nor come back with it", async () => {
    const hook = await selectTwo('["labeled","clustering"]');

    await hook.rerender('["labeled","classification"]');
    expect(selectedIds(hook)).toEqual([]);

    await hook.rerender('["labeled","clustering"]');
    expect(selectedIds(hook)).toEqual([]);
  });
});

describe("a face's own action (#599)", () => {
  it("is not pending any more once the server took it", async () => {
    const hook = await renderHook(useDashboard, "labeled");
    await act(async () => hook.current().faceActions.actions.confirm(face(5), "Anna"));
    expect(hook.current().faceActions.pendingFaceIds.has(5)).toBe(true);

    // The face moved to Anna, on the same tab: it shows again, and must not stay dimmed
    await act(async () => defined(sent[0]).callbacks.onSuccess?.());
    expect(hook.current().faceActions.pendingFaceIds.has(5)).toBe(false);
  });
});

describe("useTabScrollRequest", () => {
  it("asks for a tab's saved position once, however far the grid got", async () => {
    const positions = { labeled: 300, inferred: 300 };
    const hook = await renderHook<FacesTab, ReturnType<typeof useTabScrollRequest>>(
      tab => useTabScrollRequest(tab, positions),
      "labeled"
    );
    expect(hook.current().scrollTo).toBeNull();

    await hook.rerender("inferred");
    expect(hook.current().scrollTo).toBe(300);

    // The list is shorter than the saved position: the grid stops at 120
    await act(async () => hook.current().onScrolled());
    expect(hook.current().scrollTo).toBeNull();

    // Back on Labeled, saved at the same position: asked for again, so the grid scrolls there
    await hook.rerender("labeled");
    expect(hook.current().scrollTo).toBe(300);
  });
});
