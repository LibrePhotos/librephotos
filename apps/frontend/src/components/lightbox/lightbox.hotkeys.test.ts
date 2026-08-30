/**
 * A hotkey that never fires is indistinguishable from one that works.
 *
 * Play/pause was bound as `" "` and, because Mantine's parser splits on "+" and
 * trims each part, resolved to an empty key that matched nothing -- so Space
 * did nothing in the lightbox while being listed in the documentation and shown
 * in the toolbar. Nothing failed; the key was simply dead.
 *
 * So each binding is run through Mantine's own dispatcher, with the event a
 * browser really sends, and asked whether the handler was reached.
 */
import { getHotkeyHandler } from "@mantine/hooks";
import { describe, expect, it, vi } from "vitest";
import {
  NEXT_KEY,
  PLAY_PAUSE_KEY,
  PREVIOUS_KEY,
  SEEK_BACK_KEY,
  SEEK_FORWARD_KEY,
  SEEK_LONG_BACK_KEY,
  SEEK_LONG_FORWARD_KEY,
} from "./lightbox.hotkeys";

/** Does `binding` fire when the browser reports this keypress? */
function fires(binding: string, key: string, { shift = false, ctrl = false } = {}) {
  const handler = vi.fn();
  getHotkeyHandler([[binding, handler]])({
    key,
    code: key === " " ? "Space" : key,
    altKey: false,
    metaKey: false,
    ctrlKey: ctrl,
    shiftKey: shift,
    preventDefault: () => {},
  } as unknown as KeyboardEvent);
  return handler.mock.calls.length > 0;
}

describe("lightbox hotkeys", () => {
  it("play/pause answers to the space bar", () => {
    expect(fires(PLAY_PAUSE_KEY, " ")).toBe(true);
  });

  it("the spelling that broke it stays broken, which is why the constant exists", () => {
    // Kept as the reason the name is not written inline: " " is trimmed away.
    expect(fires(" ", " ")).toBe(false);
  });

  it("the arrows move between photos", () => {
    expect(fires(PREVIOUS_KEY, "ArrowLeft")).toBe(true);
    expect(fires(NEXT_KEY, "ArrowRight")).toBe(true);
  });

  it("shift and the arrows seek", () => {
    expect(fires(SEEK_BACK_KEY, "ArrowLeft", { shift: true })).toBe(true);
    expect(fires(SEEK_FORWARD_KEY, "ArrowRight", { shift: true })).toBe(true);
  });

  it("ctrl and the arrows take the long jump", () => {
    expect(fires(SEEK_LONG_BACK_KEY, "ArrowLeft", { ctrl: true })).toBe(true);
    expect(fires(SEEK_LONG_FORWARD_KEY, "ArrowRight", { ctrl: true })).toBe(true);
  });

  it("the three arrow bindings are mutually exclusive", () => {
    // Every arrow keypress must reach exactly one of navigate, short jump and
    // long jump -- Mantine compares each modifier exactly, which is what lets
    // one key carry three jobs.
    expect(fires(NEXT_KEY, "ArrowRight", { ctrl: true })).toBe(false);
    expect(fires(SEEK_FORWARD_KEY, "ArrowRight", { ctrl: true })).toBe(false);
    expect(fires(SEEK_LONG_FORWARD_KEY, "ArrowRight", { shift: true })).toBe(false);
    expect(fires(SEEK_LONG_FORWARD_KEY, "ArrowRight")).toBe(false);
  });

  it("seeking and navigating cannot both fire on one keypress", () => {
    // Mantine compares modifiers exactly, which is the whole reason the arrows
    // can keep their job while Shift gains a new one.
    expect(fires(NEXT_KEY, "ArrowRight", { shift: true })).toBe(false);
    expect(fires(SEEK_FORWARD_KEY, "ArrowRight")).toBe(false);
  });
});
