/**
 * - The markers are laid out against the target's height: a grid that grows without new
 *   scroll positions moves them.
 * - A jump of more than 600px shows the scrubber, which hides again 2.5 s after the last one.
 * - Under a sticky header it starts at the header's bottom edge, and a banner above the target is
 *   part of its scale (the timeline's memories pushed it down and off the page).
 * - The thumb is dragged; a press on the hidden scrubber only shows it.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { ScrollScrubber } from "./ScrollScrubber";
import classes from "./ScrollScrubber.module.css";
import { SCROLL_SCRUBBER_TARGET } from "./scrollScrubberTarget";
import type { ScrollerData, ScrubberStyle } from "./scrollScrubberTypes";

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
  vi.unstubAllGlobals();
  // Back to the top: deleting the property would leave later tests without a scrollY at all.
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
});

const positions: ScrollerData[] = [
  { label: "A", targetY: 0 },
  { label: "B", targetY: 1000 },
];

type Options = {
  scrollToY?: (y: number) => void;
  variant?: ScrubberStyle;
  stickyHeader?: React.RefObject<HTMLElement | null>;
  scrollPositions?: ScrollerData[];
  targetClass?: string;
};

function render(targetHeight: number, options: Options = {}) {
  act(() => {
    root.render(
      <MantineProvider>
        <ScrollScrubber
          type="labels"
          scrollPositions={options.scrollPositions ?? positions}
          targetHeight={targetHeight}
          scrollToY={options.scrollToY ?? (() => {})}
          variant={options.variant}
          stickyHeader={options.stickyHeader}
        >
          <div className={options.targetClass} />
        </ScrollScrubber>
      </MantineProvider>
    );
  });
}

// The scrubber measures the window after a 500 ms debounce
function renderMeasured(targetHeight: number, options: Options = {}) {
  render(targetHeight, options);
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

const scrubber = () => {
  const element = container.querySelector<HTMLElement>(`.${defined(classes.scrubber)}`);
  if (!element) throw new Error("the scrubber is not rendered");
  return element;
};

const markers = () => [...container.querySelectorAll<HTMLElement>(`.${defined(classes.marker)}`)];
const markerTops = () => markers().map(marker => parseFloat(marker.style.top));
const isShown = () => scrubber().hasAttribute("data-visible");

function scrollWindowTo(y: number, targetHeight: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  render(targetHeight);
}

// Like render, but the child is the scroll target the scrubber reads its position from
function renderWithTarget(targetHeight: number) {
  render(targetHeight, { targetClass: SCROLL_SCRUBBER_TARGET });
}

// The scrubber is 500px tall (see the useElementSize mock) along the right edge of the window.
const SCRUBBER_RECT = DOMRect.fromRect({ x: 964, y: 0, width: 36, height: 500 });

/** Gives the scrubber a layout and the pointer capture jsdom lacks; scrolls happen at once. */
function prepareForPointer() {
  const element = scrubber();
  element.getBoundingClientRect = () => SCRUBBER_RECT;
  element.setPointerCapture = () => {};
  element.hasPointerCapture = () => true;
  element.releasePointerCapture = () => {};
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
}

function pointer(type: "pointerdown" | "pointermove" | "pointerup", clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: 990, clientY, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  act(() => {
    scrubber().dispatchEvent(event);
  });
}

/** Points at the scrubber, which shows it and its labels. */
function pointAt(y: number) {
  act(() => {
    scrubber().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  pointer("pointermove", y);
}

describe("ScrollScrubber", () => {
  it("lays the markers out again when the target grows", () => {
    const viewport = window.innerHeight;
    renderMeasured(2000);
    prepareForPointer();
    pointAt(10);

    expect(markerTops()).toHaveLength(2);
    expect(markerTops()[1]).toBeCloseTo((1000 * 100) / (2000 - viewport));

    render(4000);

    expect(markerTops()[1]).toBeCloseTo((1000 * 100) / (4000 - viewport));
  });

  // #2245: mouse only; keyboard and screen reader users scroll the page itself
  it("is hidden from assistive technology", () => {
    renderMeasured(2000);

    expect(scrubber().getAttribute("aria-hidden")).toBe("true");
  });

  it("shows itself on a long scroll and hides again", () => {
    renderMeasured(5000);
    expect(isShown()).toBe(false);

    scrollWindowTo(100, 5000);
    // Throttled to one check a second: the jump is picked up on the trailing call
    scrollWindowTo(1000, 5000);
    expect(isShown()).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(isShown()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(isShown()).toBe(false);
  });

  it("stays up while the long scrolls go on", () => {
    renderMeasured(5000);
    scrollWindowTo(100, 5000);
    scrollWindowTo(1000, 5000);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(isShown()).toBe(true);

    // Another jump while it is shown restarts the 2.5 s countdown
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    scrollWindowTo(2000, 5000);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(isShown()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(isShown()).toBe(false);
  });

  it("stays hidden on a short scroll", () => {
    renderMeasured(5000);

    scrollWindowTo(100, 5000);
    scrollWindowTo(500, 5000);
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(isShown()).toBe(false);
  });

  it("shows nothing and no NaN when the target fits on screen", () => {
    // The scroll target fits on screen, so its scrollable range is 0. Scroll down first, then
    // back to the top: the position marker is recomputed on that scroll, and the scale divides by 0.
    const consoleErrors = vi.spyOn(console, "error").mockImplementation(() => {});
    const viewport = window.innerHeight;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 1 });
    renderWithTarget(viewport);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    renderWithTarget(viewport);

    expect(container.querySelector(`.${defined(classes.scrubber)}`)).toBeNull();
    expect(container.innerHTML).not.toContain("NaN");
    expect(consoleErrors.mock.calls.map(args => args.join(" ")).filter(text => text.includes("NaN"))).toEqual([]);
    consoleErrors.mockRestore();
  });

  it("keeps the position marker a number when the target grows past the screen", () => {
    // Same fit-on-screen scroll as above, then the grid grows and the scrubber appears: the
    // marker, computed while nothing scrolled, must not carry a NaN into the render.
    const consoleErrors = vi.spyOn(console, "error").mockImplementation(() => {});
    const viewport = window.innerHeight;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 1 });
    renderWithTarget(viewport);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    renderWithTarget(viewport);
    renderWithTarget(viewport + 2000);
    act(() => {
      scrubber().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    expect(container.innerHTML).not.toContain("NaN");
    expect(consoleErrors.mock.calls.map(args => args.join(" ")).filter(text => text.includes("NaN"))).toEqual([]);
    consoleErrors.mockRestore();
  });

  it("starts under the sticky header and scales in what sits above the target", () => {
    // The sticky header ends 100px down the window; a 300px banner sits between it and the grid.
    const header = document.createElement("div");
    header.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 50, width: 1000, height: 50 });
    const stickyHeader = { current: header };
    // The page: the 400px above the grid, the grid and its padding. The window scrolls the rest.
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 2420 });
    const scrolls: number[] = [];
    const scrollToY = (y: number) => scrolls.push(y);
    renderMeasured(2000, { stickyHeader, scrollToY });
    const rootElement = defined(scrubber().parentElement);
    rootElement.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 400, width: 1000, height: 2000 });
    // Measured again once the page changes size (here: a new target height).
    renderMeasured(2001, { stickyHeader, scrollToY });

    expect(scrubber().style.top).toBe("100px");
    prepareForPointer();
    pointAt(10);
    const range = 2420 - window.innerHeight;
    // "B" is 1000px into the grid, which itself starts 300px into the page's scroll.
    expect(markerTops()[1]).toBeCloseTo(((300 + 1000) * 100) / range);

    act(() => {
      defined(markers()[1]).click();
    });
    expect(scrolls).toEqual([1300]);
    Reflect.deleteProperty(document.documentElement, "scrollHeight");
  });

  it("drags the thumb along the track", () => {
    const scrolls: number[] = [];
    renderMeasured(2000, { scrollToY: y => scrolls.push(y) });
    prepareForPointer();
    pointAt(0);

    pointer("pointerdown", 100);
    pointer("pointermove", 250);
    pointer("pointerup", 250);
    pointer("pointermove", 400);

    const range = 2000 - window.innerHeight;
    expect(scrolls).toHaveLength(2);
    expect(scrolls[0]).toBeCloseTo((100 * range) / 500);
    expect(scrolls[1]).toBeCloseTo((250 * range) / 500);
  });

  it("only shows itself on a press while hidden", () => {
    const scrolls: number[] = [];
    renderMeasured(2000, { scrollToY: y => scrolls.push(y) });
    prepareForPointer();

    pointer("pointerdown", 100);

    expect(isShown()).toBe(true);
    expect(scrolls).toEqual([]);
  });

  it("draws a bar per month in the density style, the hovered one marked", () => {
    const months: ScrollerData[] = Array.from({ length: 12 }, (_, i) => ({
      label: `day ${i}`,
      targetY: i * 100,
      year: 2024,
      month: 12 - i,
      count: i === 3 ? 40 : 10,
    }));
    renderMeasured(5000, { variant: "density", scrollPositions: months });
    prepareForPointer();

    const bars = [...container.querySelectorAll<HTMLElement>(`.${defined(classes.bar)}`)];
    expect(bars).toHaveLength(12);
    // The fullest month is the widest bar.
    const widths = bars.map(bar => parseFloat(bar.style.width));
    expect(Math.max(...widths)).toBe(widths[3]);

    pointAt(parseFloat(defined(bars[3]).style.top) + 0.5);
    expect(bars.findIndex(bar => bar.hasAttribute("data-hovered"))).toBe(3);
    expect(container.querySelector(`.${defined(classes.bubble)}`)).not.toBeNull();
  });
});
