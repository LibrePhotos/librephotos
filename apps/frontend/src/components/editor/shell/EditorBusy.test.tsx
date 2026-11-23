/**
 * The editor while a save or a revert runs: inert (no panel, gesture, bar or key acts), saying what
 * it waits for; it closes when the server answers, and a failed request makes it live again with
 * nothing lost. The mutations are stateful fakes the test answers by hand.
 */
import type { PhotoEdit, PhotoEditUpdate } from "@librephotos/api-client";
import { act, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import {
  buttonWithText,
  byLabel,
  click,
  editOf,
  mountEditor,
  press,
  settle,
  stubBrowser,
  type MountedEditor,
} from "../editorHarness.test-utils";

type Answer = Readonly<{ succeed: () => void; fail: () => void }>;
type Options = { onSuccess?: () => void; onError?: () => void };

const stubs = vi.hoisted(() => ({
  edit: undefined as PhotoEdit | undefined,
  saves: [] as { edit: PhotoEditUpdate; answer: Answer }[],
  reverts: [] as Answer[],
}));

/** A mutation that stays pending until the test answers it, as React Query's would. */
function useFakeMutation<V>(record: (variables: V, answer: Answer) => void) {
  const [isPending, setPending] = useState(false);
  return {
    isPending,
    mutate: (variables: V, options?: Options) => {
      setPending(true);
      record(variables, {
        succeed: () => {
          setPending(false);
          options?.onSuccess?.();
        },
        fail: () => {
          setPending(false);
          options?.onError?.();
        },
      });
    },
  };
}

vi.mock("../../../api_client/editing/photoEdits", () => ({
  usePhotoEditQuery: () => ({
    data: stubs.edit,
    isFetchedAfterMount: true,
    isError: false,
    isFetching: false,
    refetch: () => Promise.resolve(),
  }),
  useSavePhotoEditMutation: () =>
    useFakeMutation<{ edit: PhotoEditUpdate }>(({ edit }, answer) => stubs.saves.push({ edit, answer })),
  useDeletePhotoEditMutation: () => useFakeMutation<string>((_id, answer) => stubs.reverts.push(answer)),
  fetchEditSource: () => Promise.reject(new Error("not in a test")),
}));
vi.mock("../../../service/notifications", () => ({ notification: { success: () => {}, warning: () => {} } }));
vi.mock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle" }) }));

beforeAll(stubBrowser);

let editor: MountedEditor | null = null;
afterEach(async () => {
  await editor?.unmount();
  editor = null;
  stubs.saves.length = 0;
  stubs.reverts.length = 0;
});

const field = (label: string) => {
  const found = byLabel(label);
  if (!(found instanceof HTMLInputElement)) throw new Error(`${label} is no field`);
  return found;
};

async function typeValue(label: string, text: string) {
  const input = field(label);
  await act(async () => {
    input.focus();
  });
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.blur();
  });
}

/** The workspace (bar, canvas and panel) and the status over it. */
const frame = () => defined(document.querySelector<HTMLElement>("[aria-busy]"));
const shell = () => defined(frame().firstElementChild);
const status = () => defined(document.querySelector<HTMLElement>('[aria-busy] > [role="status"]'));

describe("the editor while saving or reverting", { timeout: 20000 }, () => {
  it("is inert and says so while the save runs, then closes when the server answers", async () => {
    stubs.edit = editOf();
    editor = await mountEditor();
    expect(frame().getAttribute("aria-busy")).toBe("false");
    expect(status().textContent).toBe("");

    await typeValue("Contrast", "40");
    await click(buttonWithText("Save"));
    expect(stubs.saves).toHaveLength(1);
    expect(frame().getAttribute("aria-busy")).toBe("true");
    expect(shell().hasAttribute("inert")).toBe(true);
    expect(status().textContent).toBe("Saving the edit…");

    // No key acts meanwhile: undo would change what was sent, Escape would ask a question.
    await press("z", { ctrlKey: true });
    expect(field("Contrast").value).toBe("+40");
    await press("Escape");
    expect(document.body.textContent).not.toContain("Save your changes?");
    expect(editor.onClose).not.toHaveBeenCalled();

    await act(async () => defined(stubs.saves[0]).answer.succeed());
    expect(editor.onClose).toHaveBeenCalledTimes(1);
    expect(defined(stubs.saves[0]).edit.settings).toEqual({ version: 1, light: { contrast: 40 } });
  });

  it("is live again after a failed save, with nothing lost", async () => {
    stubs.edit = editOf();
    editor = await mountEditor();
    await typeValue("Contrast", "25");
    await click(buttonWithText("Save"));
    await act(async () => defined(stubs.saves[0]).answer.fail());
    await settle();

    expect(editor.onClose).not.toHaveBeenCalled();
    expect(frame().getAttribute("aria-busy")).toBe("false");
    expect(document.querySelector("[inert]")).toBeNull();
    expect(field("Contrast").value).toBe("+25");
    await press("z", { ctrlKey: true });
    expect(field("Contrast").value).toBe("0");
  });

  it("is inert while a revert runs", async () => {
    stubs.edit = editOf({ version: 2, settings: { version: 1, light: { contrast: 20 } } });
    editor = await mountEditor();
    await click(byLabel("More actions"));
    await click(buttonWithText("Revert to original..."));
    await click(buttonWithText("Revert"));
    expect(stubs.reverts).toHaveLength(1);
    expect(shell().hasAttribute("inert")).toBe(true);
    expect(status().textContent).toBe("Reverting to the original…");

    await act(async () => defined(stubs.reverts[0]).succeed());
    expect(editor.onClose).toHaveBeenCalledTimes(1);
  });
});
