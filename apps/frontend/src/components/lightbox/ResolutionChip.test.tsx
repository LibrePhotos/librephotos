import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chipState, ResolutionChip, type ChipState } from "./ResolutionChip";

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no matchMedia, MantineProvider needs it
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
});

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

async function render(state: ChipState, visible = true) {
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <ResolutionChip state={state} visible={visible} onRetry={() => {}} downloadUrl="/media/photos/abc" />
      </MantineProvider>
    );
  });
}

/** The chip's words (Mantine adds style tags beside them). */
function chipText(): string | null {
  const chip = container.querySelector('[role="status"]');
  return chip ? [...chip.querySelectorAll("p")].map(p => p.textContent).join(" ") : null;
}

describe("ResolutionChip", () => {
  it("names the size for two seconds, then just says Original, also on the next zoom", async () => {
    const shown: ChipState = { kind: "original", size: { width: 6000, height: 4000 } };
    await render(shown);
    expect(chipText()).toBe("lightbox.original.shownsize");

    await act(async () => vi.advanceTimersByTime(2000));
    expect(chipText()).toBe("lightbox.original.shown");

    await render(shown, false);
    expect(chipText()).toBeNull();
    await render(shown);
    expect(chipText()).toBe("lightbox.original.shown");
  });

  it("says Original without a size it does not know", async () => {
    await render({ kind: "original", size: null });
    expect(chipText()).toBe("lightbox.original.shown");
  });
});

describe("chipState", () => {
  const idle = { status: "idle" as const, size: null };

  it("has no chip without a plan", () => {
    expect(chipState({ kind: "none" }, idle)).toBeNull();
  });

  it("follows the original's load", () => {
    expect(chipState({ kind: "load" }, idle)).toEqual({ kind: "loading" });
    expect(chipState({ kind: "load" }, { status: "loading", size: null })).toEqual({ kind: "loading" });
    expect(chipState({ kind: "load" }, { status: "failed", size: null })).toEqual({ kind: "failed" });
    expect(chipState({ kind: "load" }, { status: "loaded", size: { width: 2, height: 1 } })).toEqual({
      kind: "original",
      size: { width: 2, height: 1 },
    });
  });

  it("passes a preview and an already-shown original through", () => {
    expect(chipState({ kind: "preview", reason: "raw" }, idle)).toEqual({ kind: "preview", reason: "raw" });
    expect(chipState({ kind: "original", size: null }, idle)).toEqual({ kind: "original", size: null });
  });
});
