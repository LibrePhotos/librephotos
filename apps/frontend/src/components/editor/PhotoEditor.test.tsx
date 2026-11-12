/**
 * The photo editor around its session: a slider drag is one history step, undone and redone from
 * the keyboard; closing asks only when something is unsaved; Save sends the session and closes, a
 * failed save keeps it open; Revert asks before it removes the edit; the crop frame moves with the
 * arrow keys as one crop step. The renderer and the API hooks are fakes (no WebGL in jsdom).
 */
import type { PhotoEdit, PhotoEditUpdate } from "@librephotos/api-client";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
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
} from "./editorHarness.test-utils";

type SaveOptions = { onSuccess?: () => void };
const stubs = vi.hoisted(() => ({
  edit: undefined as PhotoEdit | undefined,
  save: vi.fn<(variables: { photoId: string; edit: PhotoEditUpdate }, options?: SaveOptions) => void>(),
  remove: vi.fn<(photoId: string, options?: SaveOptions) => void>(),
  toast: vi.fn<(message: string) => void>(),
}));

vi.mock("../../api_client/editing/photoEdits", () => ({
  usePhotoEditQuery: () => ({
    data: stubs.edit,
    isFetchedAfterMount: true,
    isError: false,
    isFetching: false,
    refetch: () => Promise.resolve(),
  }),
  useSavePhotoEditMutation: () => ({ mutate: stubs.save, isPending: false }),
  useDeletePhotoEditMutation: () => ({ mutate: stubs.remove, isPending: false }),
  fetchEditSource: () => Promise.reject(new Error("not in a test")),
}));
vi.mock("../../service/notifications", () => ({ notification: { success: stubs.toast } }));
// No router here: the leave guard's blocker stays idle.
vi.mock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle" }) }));

beforeAll(stubBrowser);

let editor: MountedEditor | null = null;
afterEach(async () => {
  await editor?.unmount();
  editor = null;
  stubs.edit = undefined;
  stubs.save.mockReset();
  stubs.remove.mockReset();
  stubs.toast.mockReset();
});

async function open(edit: PhotoEdit = editOf()) {
  stubs.edit = edit;
  editor = await mountEditor();
  return editor;
}

/** The value field of a slider (its number, editable). */
const valueOf = (label: string) => {
  const field = byLabel(label);
  if (!(field instanceof HTMLInputElement)) throw new Error(`${label} is no field`);
  return field;
};

async function typeValue(label: string, text: string) {
  const field = valueOf(label);
  await act(async () => {
    field.focus();
  });
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    field.blur();
  });
}

/** Drag a slider's handle along its track (Mantine's useMove reads the track's rectangle). */
async function drag(label: string, xs: number[]) {
  const thumb = defined(document.querySelector<HTMLElement>(`[role="slider"][aria-label="${label}"]`));
  const track = defined(
    thumb.closest(".mantine-Slider-root")?.querySelector<HTMLElement>(".mantine-Slider-trackContainer")
  );
  track.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 10 });
  const [first, ...rest] = xs;
  await act(async () => {
    track.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: first, button: 0 }));
  });
  for (const x of rest) {
    await act(async () => {
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x }));
    });
  }
  // Released right after the last move, before Mantine applied it.
  await act(async () => {
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await settle();
}

const saveButton = () => buttonWithText("Save");
const lastSaved = () => defined(stubs.save.mock.calls.at(-1))[0];

// Each test mounts the whole editor (tabs, sliders, the canvas area, two dialogs) and drives it
// through several animation frames: heavier than vitest's 5 s allow on a loaded machine.
describe("PhotoEditor", { timeout: 20000 }, () => {
  it("draws the photo, and frees the renderer and the source when it closes", async () => {
    const { renderer, source, unmount } = await open();
    expect(renderer.frames.length).toBeGreaterThan(0);
    await unmount();
    editor = null;
    expect(renderer.disposed).toBe(true);
    expect(source.closed()).toBe(1);
  });

  it("makes one history step of a slider drag, undone and redone from the keyboard", async () => {
    await open();
    await drag("Contrast", [120, 140, 160, 180]);
    expect(valueOf("Contrast").value).toBe("+80");

    await press("z", { ctrlKey: true });
    expect(valueOf("Contrast").value).toBe("0");
    await press("z", { ctrlKey: true, shiftKey: true });
    expect(valueOf("Contrast").value).toBe("+80");

    await click(saveButton());
    const { edit } = lastSaved();
    expect(edit.history).toHaveLength(1);
    expect(edit.history[0]).toMatchObject({ action: "set", control: "light.contrast", value: 80 });
    expect(edit.history_cursor).toBe(0);
  });

  it("sends the session on Save, says so and closes", async () => {
    const { onClose } = await open();
    await typeValue("Brightness", "+0,5");
    await click(saveButton());
    expect(lastSaved().photoId).toBe("p1");
    expect(lastSaved().edit.settings).toEqual({ version: 1, light: { exposure: 0.5 } });
    expect(lastSaved().edit.history[0]).toMatchObject({ action: "set", control: "light.exposure", value: 0.5 });

    await act(async () => defined(stubs.save.mock.calls.at(-1))[1]?.onSuccess?.());
    expect(stubs.toast).toHaveBeenCalledWith("Edit saved");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open with the session as it was when a save fails", async () => {
    const { onClose } = await open();
    await typeValue("Brightness", "1");
    // The QueryClient reports the failure; the hook's onSuccess never runs.
    await click(saveButton());
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(valueOf("Brightness").value).toBe("+1.00");
    expect(saveButton().getAttribute("aria-disabled")).toBeNull();
  });

  it("does not save without a change, and says why", async () => {
    await open();
    expect(saveButton().getAttribute("aria-disabled")).toBe("true");
    await click(saveButton());
    expect(stubs.save).not.toHaveBeenCalled();
  });

  it("closes at once without changes, and asks before closing with them", async () => {
    const clean = await open();
    await click(byLabel("Close (Escape)"));
    expect(clean.onClose).toHaveBeenCalledTimes(1);
    await clean.unmount();

    const dirty = await open();
    await typeValue("Contrast", "10");
    await press("Escape");
    expect(dirty.onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Save your changes?");

    await click(buttonWithText("Keep editing"));
    expect(dirty.onClose).not.toHaveBeenCalled();
    expect(valueOf("Contrast").value).toBe("+10");

    await click(byLabel("Close (Escape)"));
    await click(buttonWithText("Discard"));
    expect(dirty.onClose).toHaveBeenCalledTimes(1);
    expect(stubs.save).not.toHaveBeenCalled();
  });

  it("asks before Revert to original and then removes the edit", async () => {
    const { onClose } = await open(editOf({ version: 2, settings: { version: 1, light: { contrast: 20 } } }));
    await click(byLabel("More actions"));
    await click(buttonWithText("Revert to original..."));
    expect(stubs.remove).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Revert to the original?");

    await click(buttonWithText("Revert"));
    expect(stubs.remove).toHaveBeenCalledWith("p1", expect.anything());
    await act(async () => defined(stubs.remove.mock.calls.at(-1))[1]?.onSuccess?.());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers no Revert for a photo without a saved edit", async () => {
    await open();
    await click(byLabel("More actions"));
    expect(buttonWithText("Copy settings")).toBeTruthy();
    expect(() => buttonWithText("Revert to original...")).toThrow();
  });

  it("moves the crop frame with the arrow keys as one crop step", async () => {
    await open();
    await click(buttonWithText("Crop & rotate"));
    await settle();
    await click(buttonWithText("1:1"));
    await settle();
    const frame = byLabel("Crop frame. The arrow keys move it, with Shift in larger steps.");
    await act(async () => {
      frame.focus();
    });
    await act(async () => {
      frame.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      frame.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    await act(async () => {
      frame.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
    });

    await click(saveButton());
    const { edit } = lastSaved();
    expect(edit.history.map(step => step.action)).toEqual(["set", "crop"]);
    const crop = defined(edit.settings.geometry?.crop ?? undefined);
    expect(crop.cx).toBeGreaterThan(0.5);
    expect(crop.w / crop.h).toBeCloseTo(300 / 400, 6);
  });
});
