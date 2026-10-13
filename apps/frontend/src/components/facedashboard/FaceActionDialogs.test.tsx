/**
 * What the per-face actions of #599 send, and the two dialogs they open: Label faces for one face,
 * and the delete confirmation (#2223), which uses the same words as the lightbox's.
 */
import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { useDeleteFacesMutation, useSetFacesPersonLabelMutation } from "../../api_client/faces";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { FaceActionDialogs } from "./FaceActionDialogs";
import { useFaceActions } from "./hooks/useFaceActions";
import type { FaceActionsState } from "./hooks/useFaceActions";
import type { FaceCell } from "./hooks/useVirtualizedGrid";

type LabelMutate = ReturnType<typeof useSetFacesPersonLabelMutation>["mutate"];
type DeleteMutate = ReturnType<typeof useDeleteFacesMutation>["mutate"];

const stubs = vi.hoisted(() => ({
  label: vi.fn<LabelMutate>(),
  remove: vi.fn<DeleteMutate>(),
}));

vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../api_client/faces", () => ({
  useSetFacesPersonLabelMutation: () => ({ mutate: stubs.label }),
  useDeleteFacesMutation: () => ({ mutate: stubs.remove }),
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useFetchPeopleAlbumsQuery: () => ({
    data: [{ id: "4", name: "Ben", video: false, face_count: 2, face_photo_url: "/ben", face_url: "/ben" }],
  }),
}));

const INFERRED: FaceCell = { id: 5, image: "/5.jpg", face_url: "/5.jpg", photo: "abc", person: null };
const LABELLED: FaceCell = { ...INFERRED, id: 6, person: 1, person_name: "Anna" };

let root: Root;
let container: HTMLDivElement;
let state: FaceActionsState | undefined;

function Harness() {
  state = useFaceActions();
  return (
    // env="test": no transitions or portals, so the dialogs render in place
    <MantineProvider env="test">
      <FaceActionDialogs state={state} />
    </MantineProvider>
  );
}

beforeAll(async () => {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // The label dialog's ScrollArea needs it
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(async () => {
  stubs.label.mockReset();
  stubs.remove.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const current = () => defined(state, "the hook's state");

async function run(action: (s: FaceActionsState) => void) {
  await act(async () => action(current()));
}

function buttonWithText(text: string): HTMLButtonElement {
  return defined(
    Array.from(document.querySelectorAll("button")).find(button => button.textContent?.includes(text)),
    `the ${text} button`
  );
}

/** Fails the request the stub got last, as the server would. */
function failLast(mutate: typeof stubs.label | typeof stubs.remove) {
  const options = mutate.mock.calls.at(-1)?.[1];
  // The hook only reads the error; the other arguments are the mutation's own
  Reflect.apply(defined(options?.onError, "an onError"), undefined, [new Error("500"), undefined, undefined]);
}

describe("per-face actions (#599)", () => {
  it("confirms a face as the person and dims it until the list drops it", async () => {
    await run(s => s.actions.confirm(INFERRED, "Anna"));

    expect(stubs.label).toHaveBeenCalledWith({ faceIds: [5], personName: "Anna" }, expect.anything());
    expect(current().pendingFaceIds.has(5)).toBe(true);
  });

  it("sends a wrong match back to the unknown group by its shared name", async () => {
    await run(s => s.actions.rejectMatch(INFERRED));

    expect(stubs.label).toHaveBeenCalledWith({ faceIds: [5], personName: UNKNOWN_PERSON_NAME }, expect.anything());
  });

  it("gives a face its buttons back when the request fails", async () => {
    await run(s => s.actions.confirm(INFERRED, "Anna"));

    await act(async () => failLast(stubs.label));

    expect(current().pendingFaceIds.has(5)).toBe(false);
  });

  it("forgets pending faces when the tab changes", async () => {
    await run(s => s.actions.rejectMatch(INFERRED));

    await run(s => s.clearPending());

    expect(current().pendingFaceIds.size).toBe(0);
  });

  it("asks before deleting, then deletes only that face", async () => {
    await run(s => s.actions.remove(INFERRED));

    expect(document.body.textContent).toContain("Delete this face?");
    // An inferred face belongs to no one yet: the dialog does not name the guess
    expect(document.body.textContent).toContain("This face disappears from this photo");
    expect(stubs.remove).not.toHaveBeenCalled();

    await act(async () => buttonWithText("Delete face").click());

    expect(stubs.remove).toHaveBeenCalledWith({ faceIds: [5] }, expect.anything());
    expect(current().pendingFaceIds.has(5)).toBe(true);
    expect(current().deleteDialogOpened).toBe(false);
  });

  it("names the person of a labelled face in the delete dialog", async () => {
    await run(s => s.actions.remove(LABELLED));

    expect(document.body.textContent).toContain("The face of Anna disappears");
  });

  it("keeps the face when the delete is cancelled, and undims it when the delete fails", async () => {
    await run(s => s.actions.remove(INFERRED));
    await act(async () => buttonWithText("Cancel").click());
    expect(stubs.remove).not.toHaveBeenCalled();

    await run(s => s.actions.remove(INFERRED));
    await act(async () => buttonWithText("Delete face").click());
    await act(async () => failLast(stubs.remove));

    expect(current().pendingFaceIds.has(5)).toBe(false);
  });

  it("labels just this face with the person picked in Label faces", async () => {
    await run(s => s.actions.labelAs(INFERRED));
    expect(document.body.textContent).toContain("Label selected 1 face(s) as…");

    await act(async () => buttonWithText("Ben").click());

    expect(stubs.label).toHaveBeenCalledWith({ faceIds: [5], personName: "Ben" }, expect.anything());
    expect(current().labelDialogOpened).toBe(false);
  });
});
