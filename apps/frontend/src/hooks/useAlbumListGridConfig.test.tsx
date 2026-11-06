import { MantineProvider, type MantineThemeOverride } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FOOTER_HEIGHT } from "../uiConstants";
import { defined } from "../util/defined.test-utils";
import { useAlbumListGridConfig } from "./useAlbumListGridConfig";

let root: Root;
let container: HTMLDivElement;
let config: ReturnType<typeof useAlbumListGridConfig> | undefined;

beforeAll(() => {
  // jsdom has no matchMedia. This one answers min-width queries from innerWidth at a 16px
  // root font size, which the hook asks about the theme's sm breakpoint.
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
  // Wide enough for six albums per row
  window.innerWidth = 1400;
  window.innerHeight = 900;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

function Harness({ reservedHeight }: { reservedHeight?: number }) {
  config = useAlbumListGridConfig({ reservedHeight });
  return null;
}

function PortraitHarness() {
  config = useAlbumListGridConfig({ shape: "portrait" });
  return null;
}

const render = async (theme?: MantineThemeOverride, reservedHeight?: number) => {
  await act(async () => {
    root.render(
      <MantineProvider theme={theme}>
        <Harness reservedHeight={reservedHeight} />
      </MantineProvider>
    );
  });
};

/** A classic scrollbar: the probe's overflow:scroll box loses `width` px to it. */
const stubScrollbar = (width: number) => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.style.overflow === "scroll" ? 100 : 0;
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this instanceof HTMLElement && this.style.overflow === "scroll" ? 100 - width : 0;
  });
};

describe("useAlbumListGridConfig", () => {
  it("lays out a whole number of albums per row, a cover with its title on it per cell", async () => {
    await render();

    expect(defined(config).columnCount).toBe(6);
    expect(defined(config).cellPadding).toBe(8);
    expect(defined(config).captionHeight).toBe(0);
    // 2px of gutter and 8px of cell padding: the covers sit 10px in, like the page header
    expect(defined(config).gutter).toBe(12);
  });

  it("makes a portrait row a third taller than wide, with more people per row", async () => {
    await act(async () => {
      root.render(
        <MantineProvider>
          <PortraitHarness />
        </MantineProvider>
      );
    });

    expect(defined(config).columnCount).toBe(8);
    const columnWidth = (1400 - 200 - 24) / 8;
    expect(defined(config).columnWidth).toBe(columnWidth);
    expect(defined(config).captionHeight).toBeCloseTo((columnWidth - 16) / 3);
  });

  it("leaves the reserved height above the grid, but always room for one row", async () => {
    await render(undefined, 250);
    expect(defined(config).height).toBe(900 - 55 - 90 - 250);

    // A short window: the map leaves less than a row
    window.innerHeight = 400;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(defined(config).height).toBe((1400 - 200 - 24) / 6);
  });

  // jsdom scrollbars take no room, like a phone's or macOS's overlay ones
  it("fills the width beside the menu, 12px in from either edge", async () => {
    await render();

    expect(defined(config).columnWidth).toBe((1400 - 200 - 24) / 6);
    expect(defined(config).height).toBe(900 - 55 - 90);
  });

  it("uses the full width and leaves room for the footer below the navbar breakpoint", async () => {
    // Between 700px and Mantine's sm breakpoint the navbar is already hidden
    window.innerWidth = 740;
    await render();

    expect(defined(config).columnCount).toBe(3);
    expect(defined(config).columnWidth).toBe((740 - 8) / 3);
    expect(defined(config).height).toBe(900 - 55 - 90 - FOOTER_HEIGHT);
  });

  it("takes the navbar breakpoint from the theme, as the AppShell does", async () => {
    // 960px, where a 20px browser font size puts 48em: at 800px the AppShell shows no navbar
    window.innerWidth = 800;
    await render({ breakpoints: { sm: "60em" } });

    expect(defined(config).columnWidth).toBe((800 - 8) / 4);
    expect(defined(config).height).toBe(900 - 55 - 90 - FOOTER_HEIGHT);
  });

  it("does not keep a scrollbar's width free on a phone", async () => {
    window.innerWidth = 375;
    await render();

    expect(defined(config).columnWidth).toBe((375 - 8) / 2);
  });

  it("keeps a classic scrollbar's width free for the grid's own scrollbar", async () => {
    stubScrollbar(15);
    await render();

    expect(defined(config).columnWidth).toBe((1400 - 200 - 24 - 15) / 6);
  });

  it("measures the scrollbar again on resize, since page zoom changes its CSS width", async () => {
    stubScrollbar(15);
    await render();

    // Zooming out to 90% in Firefox: more CSS pixels across, and a wider scrollbar in them
    stubScrollbar(17);
    window.innerWidth = 1556;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(defined(config).columnWidth).toBe((1556 - 200 - 24 - 17) / 6);
  });
});
