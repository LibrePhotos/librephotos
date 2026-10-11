/**
 * - The markers are laid out against the target's height: a grid that grows without new
 *   scroll positions moves them.
 * - A jump of more than 600px shows the scrubber, which hides again 2.5 s after the last one.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollScrubber } from "./ScrollScrubber";
import type { ScrollerData } from "./ScrollScrubberTypes.zod";

// jsdom lays nothing out: give the scrubber a fixed size
vi.mock(import("@mantine/hooks"), async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, useElementSize: () => ({ ref: () => {}, width: 40, height: 500 }) };
});

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "scrollY");
});

const positions: ScrollerData[] = [
  { label: "A", targetY: 0 },
  { label: "B", targetY: 1000 },
];

function render(targetHeight: number) {
  act(() => {
    root.render(
      <MantineProvider>
        <ScrollScrubber type="labels" scrollPositions={positions} targetHeight={targetHeight} scrollToY={() => {}}>
          <div />
        </ScrollScrubber>
      </MantineProvider>
    );
  });
}

// The scrubber measures the window after a 500 ms debounce
function renderMeasured(targetHeight: number) {
  render(targetHeight);
  act(() => vi.advanceTimersByTime(500));
}

const scrubber = () => {
  const element = container.querySelector<HTMLElement>(".scrollscrubber");
  if (!element) throw new Error("the scrubber is not rendered");
  return element;
};

const markerTops = () =>
  [...container.querySelectorAll<HTMLElement>(".scrollscrubber-marker-dot")].map(dot => parseFloat(dot.style.top));

function scrollWindowTo(y: number, targetHeight: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  render(targetHeight);
}

describe("ScrollScrubber", () => {
  it("lays the markers out again when the target grows", () => {
    const viewport = window.innerHeight;
    renderMeasured(2000);
    act(() => scrubber().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));

    expect(markerTops()).toHaveLength(2);
    expect(markerTops()[1]).toBeCloseTo((1000 * 100) / (2000 - viewport));

    render(4000);

    expect(markerTops()[1]).toBeCloseTo((1000 * 100) / (4000 - viewport));
  });

  it("shows itself on a long scroll and hides again", () => {
    renderMeasured(5000);
    expect(scrubber().style.opacity).toBe("0");

    scrollWindowTo(100, 5000);
    // Throttled to one check a second: the jump is picked up on the trailing call
    scrollWindowTo(1000, 5000);
    expect(scrubber().style.opacity).toBe("0");
    act(() => vi.advanceTimersByTime(1000));
    expect(scrubber().style.opacity).toBe("1");

    act(() => vi.advanceTimersByTime(2500));
    expect(scrubber().style.opacity).toBe("0");
  });

  it("stays up while the long scrolls go on", () => {
    renderMeasured(5000);
    scrollWindowTo(100, 5000);
    scrollWindowTo(1000, 5000);
    act(() => vi.advanceTimersByTime(1000));
    expect(scrubber().style.opacity).toBe("1");

    // Another jump while it is shown restarts the 2.5 s countdown
    act(() => vi.advanceTimersByTime(1500));
    scrollWindowTo(2000, 5000);
    act(() => vi.advanceTimersByTime(1500));
    expect(scrubber().style.opacity).toBe("1");

    act(() => vi.advanceTimersByTime(1000));
    expect(scrubber().style.opacity).toBe("0");
  });

  it("stays hidden on a short scroll", () => {
    renderMeasured(5000);

    scrollWindowTo(100, 5000);
    scrollWindowTo(500, 5000);
    act(() => vi.advanceTimersByTime(1000));

    expect(scrubber().style.opacity).toBe("0");
  });
});
