import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { ScrollScrubber } from "./ScrollScrubber";
import classes from "./ScrollScrubber.module.css";
import { ScrollerType } from "./scrollScrubberTypes";

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  // jsdom has no matchMedia. This one answers min-width queries from innerWidth at a 16px
  // root font size, which is how the browser resolves the theme's em breakpoints.
  window.matchMedia = (query: string): MediaQueryList => {
    const minWidth = /min-width:\s*([\d.]+)em/.exec(query);
    return {
      matches: minWidth ? window.innerWidth >= Number(minWidth[1]) * 16 : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  };
  // useElementSize observes the scrubber's size; jsdom has no layout to report
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

const positions = [
  { label: "2021", targetY: 0 },
  { label: "2022", targetY: 1000 },
  { label: "2023", targetY: 2000 },
];

/** Renders the scrubber at a viewport width, once its debounced resize has set the target height. */
const renderAt = async (width: number) => {
  window.innerWidth = width;
  await act(async () => {
    root.render(
      <MantineProvider>
        <ScrollScrubber
          type={ScrollerType.enum.labels}
          scrollPositions={positions}
          targetHeight={3000}
          scrollToY={() => {}}
        >
          <div>photos</div>
        </ScrollScrubber>
      </MantineProvider>
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
};

const layer = (selector: string): HTMLElement => {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`no ${selector} rendered`);
  return element;
};

describe("ScrollScrubber", () => {
  it("runs to the bottom of the page on desktop, where the navbar is shown", async () => {
    await renderAt(1024);

    expect(layer(`.${defined(classes.scrubber)}`).style.bottom).toBe("0px");
    expect(layer(`.${defined(classes.backgroundLayer)}`).style.bottom).toBe("0px");
  });

  it("stops above the phone footer below the sm breakpoint", async () => {
    // 740px is past the old 700px cut-off but still below the theme's sm (48em, 768px)
    await renderAt(740);

    expect(layer(`.${defined(classes.scrubber)}`).style.bottom).toBe("50px");
    expect(layer(`.${defined(classes.backgroundLayer)}`).style.bottom).toBe("50px");
  });

  it("switches exactly at the theme's sm breakpoint", async () => {
    await renderAt(767);
    expect(layer(`.${defined(classes.scrubber)}`).style.bottom).toBe("50px");

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await renderAt(768);
    expect(layer(`.${defined(classes.scrubber)}`).style.bottom).toBe("0px");
  });
});
