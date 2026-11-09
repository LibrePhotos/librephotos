/**
 * A menu item's shortcut is a hint at the end of its row (review s0 #7), not "(Z)" in its label:
 * Ctrl or ⌘ by platform, and named to assistive tech through `aria-keyshortcuts`.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { menuShortcut } from "./menuShortcut";

function hint(key: string) {
  const { rightSection, "aria-keyshortcuts": aria } = menuShortcut(key);
  const keys = /data-keys="([^"]*)"/.exec(renderToStaticMarkup(rightSection))?.[1];
  return { keys, aria };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("menuShortcut", () => {
  it("shows a plain key as its key cap", () => {
    expect(hint("z")).toEqual({ keys: "Z", aria: "Z" });
  });

  it("spells mod as Ctrl off Apple devices", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(hint("mod+c")).toEqual({ keys: "Ctrl+C", aria: "Control+C" });
  });

  it("spells mod as ⌘ on a Mac", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(hint("mod+c")).toEqual({ keys: "⌘C", aria: "Meta+C" });
  });
});
