import { MantineProvider, type MantineThemeOverride } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useIsDesktopLayout } from "./useIsDesktopLayout";

let root: Root;
let container: HTMLDivElement;
let isDesktop: boolean | undefined;

beforeAll(() => {
  // jsdom has no matchMedia. This one answers min-width queries from innerWidth at a 16px
  // root font size, which is how the browser resolves the em breakpoints.
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  isDesktop = undefined;
});

function Harness() {
  isDesktop = useIsDesktopLayout();
  return null;
}

const render = async (width: number, theme?: MantineThemeOverride) => {
  window.innerWidth = width;
  await act(async () => {
    root.render(
      <MantineProvider theme={theme}>
        <Harness />
      </MantineProvider>
    );
  });
};

describe("useIsDesktopLayout", () => {
  it("is false below the theme's default sm breakpoint (48em, 768px at 16px)", async () => {
    await render(740);

    expect(isDesktop).toBe(false);
  });

  it("is true from the default sm breakpoint up", async () => {
    await render(768);

    expect(isDesktop).toBe(true);
  });

  it("follows a custom sm from the theme, as the AppShell does", async () => {
    // 800px is past the default breakpoint but not past a 60em one (960px)
    await render(800, { breakpoints: { sm: "60em" } });

    expect(isDesktop).toBe(false);
  });
});
