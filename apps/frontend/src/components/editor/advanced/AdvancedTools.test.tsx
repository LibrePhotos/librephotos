/**
 * The advanced mode's tools in the whole editor: a tone curve drag is one step, a point is added and
 * removed; a wheel drag sets hue and amount in one step; Black & white shows the B&W mix; the
 * history moves the cursor; Copy and Paste settings keep the other photo's framing; Auto is one
 * `auto` step; the split view switches the render mode; a reverted edit offers no Revert.
 */
import type { PhotoEdit, PhotoEditUpdate } from "@librephotos/api-client";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { STORAGE_KEYS, writeStored } from "../../../util/storage";
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

type SaveOptions = { onSuccess?: () => void };
const stubs = vi.hoisted(() => ({
  edit: undefined as PhotoEdit | undefined,
  save: vi.fn<(variables: { photoId: string; edit: PhotoEditUpdate }, options?: SaveOptions) => void>(),
  toast: vi.fn<(message: string) => void>(),
}));

vi.mock("../../../api_client/editing/photoEdits", () => ({
  usePhotoEditQuery: () => ({
    data: stubs.edit,
    isFetchedAfterMount: true,
    isError: false,
    isFetching: false,
    refetch: () => Promise.resolve(),
  }),
  useSavePhotoEditMutation: () => ({ mutate: stubs.save, isPending: false }),
  useDeletePhotoEditMutation: () => ({ mutate: vi.fn<() => void>(), isPending: false }),
  fetchEditSource: () => Promise.reject(new Error("not in a test")),
}));
vi.mock("../../../service/notifications", () => ({ notification: { success: stubs.toast, warning: stubs.toast } }));
vi.mock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle" }) }));

beforeAll(stubBrowser);

let editor: MountedEditor | null = null;
afterEach(async () => {
  await editor?.unmount();
  editor = null;
  stubs.save.mockReset();
  stubs.toast.mockReset();
  writeStored(STORAGE_KEYS.editorCopiedLook, null);
});

async function open(edit: PhotoEdit = editOf()) {
  stubs.edit = edit;
  writeStored(STORAGE_KEYS.editorMode, "advanced");
  editor = await mountEditor();
  return editor;
}

async function saved(): Promise<PhotoEditUpdate> {
  await click(buttonWithText("Save"));
  return defined(stubs.save.mock.calls.at(-1))[0].edit;
}

/** A pointer event as React reads it (jsdom has no PointerEvent). */
async function pointer(target: Element, type: string, clientX: number, clientY: number) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY, button: 0, detail: 1 }));
  });
}

function boxed(element: HTMLElement | SVGElement, width: number, height: number) {
  element.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width, height });
}

const curveBox = () => byLabel("Tone curve (All). Click the curve to add a point.");

describe("advanced tools", { timeout: 20000 }, () => {
  it("adds a curve point by dragging the curve, as one step of curve.master", async () => {
    await open();
    await click(buttonWithText("Tone curve"));
    await settle();
    const box = curveBox();
    boxed(box, 256, 256);
    await pointer(box, "pointerdown", 128, 128);
    await pointer(box, "pointermove", 128, 96);
    await pointer(box, "pointermove", 128, 64);
    await pointer(box, "pointerup", 128, 64);
    await settle();
    const edit = await saved();
    expect(edit.history).toHaveLength(1);
    expect(edit.history[0]).toMatchObject({ action: "set", control: "curve.master" });
    expect(edit.settings.curve?.master).toEqual([
      [0, 0],
      [0.5, 0.75],
      [1, 1],
    ]);
  });

  it("removes a point with the Delete key, as its own step", async () => {
    await open(
      editOf({
        settings: {
          version: 1,
          curve: {
            master: [
              [0, 0],
              [0.3, 0.2],
              [1, 1],
            ],
          },
        },
      })
    );
    await click(buttonWithText("Tone curve"));
    const point = byLabel("Point 2 of 3 (All). The arrow keys move it, Delete removes it.");
    await act(async () => {
      point.dispatchEvent(new FocusEvent("focus"));
    });
    await press("Delete", {}, point);
    const edit = await saved();
    expect(edit.history.map(step => step.control)).toEqual(["curve.master"]);
    expect(edit.settings.curve).toBeUndefined();
  });

  it("sets a wheel's hue and amount in one step by dragging its handle", async () => {
    await open();
    await click(buttonWithText("Color grading"));
    await settle();
    const wheel = byLabel(
      "Shadows color wheel. The left and right arrow keys turn the hue, up and down change the amount."
    );
    boxed(wheel, 100, 100);
    await pointer(wheel, "pointerdown", 100, 50);
    await pointer(wheel, "pointermove", 50, 0);
    await pointer(wheel, "pointerup", 50, 0);
    expect(wheel.getAttribute("aria-valuetext")).toBe("Hue 90°, amount 100");
    const edit = await saved();
    expect(edit.history).toHaveLength(1);
    expect(edit.settings.grading).toEqual({ shadows: { hue: 90, sat: 100 } });
  });

  it("shows the B&W mix instead of the color mixer for black and white", async () => {
    await open();
    expect(() => buttonWithText("B&W mix")).toThrow();
    expect(buttonWithText("Color mixer")).toBeTruthy();
    await click(defined([...document.querySelectorAll("label")].find(label => label.textContent === "Black & white")));
    await settle();
    expect(buttonWithText("B&W mix")).toBeTruthy();
    expect(() => buttonWithText("Color mixer")).toThrow();
    expect(byLabel("B&W Magenta")).toBeTruthy();
    const edit = await saved();
    expect(edit.history[0]).toMatchObject({ action: "set", control: "color.treatment", value: "bw" });
  });

  it("goes to a history step on click and shows the later ones as undone", async () => {
    const steps = [0.1, 0.2, 0.3].map((exposure, i) => ({
      action: "set" as const,
      control: "light.exposure",
      value: exposure,
      at: `2026-11-12T09:3${i}:00Z`,
      settings: { version: 1 as const, light: { exposure } },
    }));
    await open(
      editOf({ version: 1, settings: { version: 1, light: { exposure: 0.3 } }, history: steps, history_cursor: 2 })
    );
    const rows = [...document.querySelectorAll<HTMLButtonElement>('ol[aria-label="Edit history"] button')];
    expect(rows.map(row => row.textContent)).toEqual([
      "Exposure +0.30",
      "Exposure +0.20",
      "Exposure +0.10",
      "Original",
    ]);
    expect(rows[0]?.getAttribute("aria-current")).toBe("step");
    await click(defined(rows[2]));
    expect(rows[2]?.getAttribute("aria-current")).toBe("step");
    expect(rows[0]?.hasAttribute("data-undone")).toBe(true);
    expect(rows[1]?.hasAttribute("data-undone")).toBe(true);
    expect(byLabel("Exposure")).toHaveProperty("value", "+0.10");

    // The keys work with the focus on a switch (the Simple | Advanced radios), not in a text field.
    const radio = defined(document.querySelector<HTMLInputElement>('input[type="radio"][value="advanced"]'));
    await press("z", { ctrlKey: true, shiftKey: true }, radio);
    expect(byLabel("Exposure")).toHaveProperty("value", "+0.20");
  });

  it("pastes copied settings onto another photo, keeping that photo's framing", async () => {
    await open(
      editOf({ version: 1, settings: { version: 1, light: { contrast: 25 }, geometry: { orientation: 90 } } })
    );
    await press("C", { ctrlKey: true, shiftKey: true });
    expect(stubs.toast).toHaveBeenCalledWith("Settings copied. Open another photo and choose Paste settings.");
    await defined(editor).unmount();
    const crop = { cx: 0.5, cy: 0.5, w: 0.5, h: 0.5 };
    await open(editOf({ version: 1, settings: { version: 1, geometry: { crop }, color: { vibrance: 10 } } }));
    await press("V", { ctrlKey: true, shiftKey: true });
    const edit = await saved();
    expect(edit.history.map(step => step.action)).toEqual(["paste"]);
    expect(edit.settings).toEqual({ version: 1, geometry: { crop }, light: { contrast: 25 } });
  });

  it("says so when there is nothing to paste", async () => {
    await open();
    await press("V", { ctrlKey: true, shiftKey: true });
    expect(stubs.toast).toHaveBeenCalledWith("Nothing to paste yet: choose Copy settings on an edited photo first.");
  });

  it("makes one auto step from the histogram of the photo before its edits", async () => {
    const { renderer } = await open();
    const dark = new Uint32Array(256);
    for (let i = 10; i < 60; i++) dark[i] = 100;
    renderer.histogramValue = { r: dark, g: dark, b: dark, luma: dark };
    await click(buttonWithText("Auto"));
    expect(renderer.histogramCalls).toContain("before");
    const edit = await saved();
    expect(edit.history.map(step => step.action)).toEqual(["auto"]);
    expect(edit.settings.light?.exposure ?? 0).toBeGreaterThan(0.5);
  });

  it("offers no Auto while the crop tool is open, and says why", async () => {
    const { renderer } = await open();
    await click(buttonWithText("Crop & rotate"));
    await settle();
    const auto = buttonWithText("Auto");
    expect(auto.getAttribute("aria-disabled")).toBe("true");
    expect(document.body.textContent).toContain("Not available while cropping: close the crop tool first");
    await click(auto);
    expect(renderer.histogramCalls).not.toContain("before");
  });

  it("names the compare button for what it shows: the adjustments off, the crop and rotation kept", async () => {
    await open();
    const label = byLabel(
      `Hold to see the photo before its adjustments, with its crop and rotation (${String.fromCharCode(92)})`
    );
    expect(label.tagName).toBe("BUTTON");
    expect(document.querySelector('[aria-label*="original"]')).toBeNull();
  });

  it("switches the split view with Y and its button, and draws it", async () => {
    const { renderer } = await open();
    await press("y");
    await settle();
    expect(renderer.frames.at(-1)?.options.mode).toBe("split");
    expect(byLabel("Before and after side by side (Y)").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel("Divider between before and after. The arrow keys move it.")).toBeTruthy();
    await click(byLabel("Before and after side by side (Y)"));
    await settle();
    expect(renderer.frames.at(-1)?.options.mode).toBe("after");
  });

  it("offers no Revert for an edit that was reverted (default recipe, no history)", async () => {
    await open(editOf({ version: 3 }));
    await click(byLabel("More actions"));
    expect(() => buttonWithText("Revert to original...")).toThrow();
    expect(buttonWithText("Copy settings")).toBeTruthy();
  });
});
