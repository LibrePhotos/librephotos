/**
 * - The markers are laid out against the target's height: a grid that grows without new
 *   scroll positions moves them.
 * - A jump of more than 600px shows the scrubber, which hides again 2.5 s after the last one.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { ScrollScrubber } from "./ScrollScrubber";
import classes from "./ScrollScrubber.module.css";
import { SCROLL_SCRUBBER_TARGET } from "./scrollScrubberTarget";
import type { ScrollerData } from "./scrollScrubberTypes";

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
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

const scrubber = () => {
  const element = container.querySelector<HTMLElement>(`.${defined(classes.scrubber)}`);
  if (!element) throw new Error("the scrubber is not rendered");
  return element;
};

const markerTops = () =>
  [...container.querySelectorAll<HTMLElement>(`.${defined(classes.markerDot)}`)].map(dot => parseFloat(dot.style.top));

function scrollWindowTo(y: number, targetHeight: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  render(targetHeight);
}

// Like render, but the child is the scroll target the scrubber reads its position from
function renderWithTarget(targetHeight: number) {
  act(() => {
    root.render(
      <MantineProvider>
        <ScrollScrubber type="labels" scrollPositions={positions} targetHeight={targetHeight} scrollToY={() => {}}>
          <div className={SCROLL_SCRUBBER_TARGET} />
        </ScrollScrubber>
      </MantineProvider>
    );
  });
}

describe("ScrollScrubber", () => {
  it("lays the markers out again when the target grows", () => {
    const viewport = window.innerHeight;
    renderMeasured(2000);
    act(() => {
      scrubber().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    expect(markerTops()).toHaveLength(2);
    expect(markerTops()[1]).toBeCloseTo((1000 * 100) / (2000 - viewport));

    render(4000);

    expect(markerTops()[1]).toBeCloseTo((1000 * 100) / (4000 - viewport));
  });

  // #2245: mouse only; keyboard and screen reader users scroll the page itself
  it("is hidden from assistive technology, its background layer too", () => {
    renderMeasured(2000);

    expect(scrubber().getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(`.${defined(classes.backgroundLayer)}`)?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows itself on a long scroll and hides again", () => {
    renderMeasured(5000);
    expect(scrubber().style.opacity).toBe("0");

    scrollWindowTo(100, 5000);
    // Throttled to one check a second: the jump is picked up on the trailing call
    scrollWindowTo(1000, 5000);
    expect(scrubber().style.opacity).toBe("0");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(scrubber().style.opacity).toBe("1");

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(scrubber().style.opacity).toBe("0");
  });

  it("stays up while the long scrolls go on", () => {
    renderMeasured(5000);
    scrollWindowTo(100, 5000);
    scrollWindowTo(1000, 5000);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(scrubber().style.opacity).toBe("1");

    // Another jump while it is shown restarts the 2.5 s countdown
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    scrollWindowTo(2000, 5000);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(scrubber().style.opacity).toBe("1");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(scrubber().style.opacity).toBe("0");
  });

  it("stays hidden on a short scroll", () => {
    renderMeasured(5000);

    scrollWindowTo(100, 5000);
    scrollWindowTo(500, 5000);
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(scrubber().style.opacity).toBe("0");
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
});
