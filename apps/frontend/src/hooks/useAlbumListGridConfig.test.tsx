import { MantineProvider, type MantineThemeOverride } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

function Harness({ albums }: { albums: readonly unknown[] }) {
  config = useAlbumListGridConfig(albums);
  return null;
}

const albums = (count: number) => Array.from({ length: count }, (_, id) => ({ id }));

const render = async (count: number, theme?: MantineThemeOverride) => {
  await act(async () => {
    root.render(
      <MantineProvider theme={theme}>
        <Harness albums={albums(count)} />
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
  it("lays out a whole number of albums per row", async () => {
    await render(13);

    expect(defined(config).entriesPerRow).toBe(6);
    expect(defined(config).numberOfRows).toBe(3);
  });

  it("drops the rows a shrinking list no longer fills (places filtered by the map)", async () => {
    await render(13);
    await render(4);

    expect(defined(config).numberOfRows).toBe(1);
  });

  it("has no rows once the list is empty", async () => {
    await render(13);
    await render(0);

    expect(defined(config).numberOfRows).toBe(0);
  });

  // jsdom scrollbars take no room, like a phone's or macOS's overlay ones
  it("fills the width beside the menu, 5px in from either edge", async () => {
    await render(13);

    expect(defined(config).entrySquareSize).toBe((1400 - 200 - 10) / 6);
    expect(defined(config).gridHeight).toBe(900 - 55 - 90);
  });

  it("uses the full width and leaves room for the footer below the navbar breakpoint", async () => {
    // Between 700px and Mantine's sm breakpoint the navbar is already hidden
    window.innerWidth = 740;
    await render(13);

    expect(defined(config).entriesPerRow).toBe(3);
    expect(defined(config).entrySquareSize).toBe((740 - 10) / 3);
    expect(defined(config).gridHeight).toBe(900 - 55 - 90 - 50);
  });

  it("takes the navbar breakpoint from the theme, as the AppShell does", async () => {
    // 960px, where a 20px browser font size puts 48em: at 800px the AppShell shows no navbar
    window.innerWidth = 800;
    await render(13, { breakpoints: { sm: "60em" } });

    expect(defined(config).entrySquareSize).toBe((800 - 10) / 4);
    expect(defined(config).gridHeight).toBe(900 - 55 - 90 - 50);
  });

  it("does not keep a scrollbar's width free on a phone", async () => {
    window.innerWidth = 375;
    await render(13);

    expect(defined(config).entrySquareSize).toBe((375 - 10) / 2);
  });

  it("keeps a classic scrollbar's width free for the grid's own scrollbar", async () => {
    stubScrollbar(15);
    await render(13);

    expect(defined(config).entrySquareSize).toBe((1400 - 200 - 10 - 15) / 6);
  });

  it("measures the scrollbar again on resize, since page zoom changes its CSS width", async () => {
    stubScrollbar(15);
    await render(13);

    // Zooming out to 90% in Firefox: more CSS pixels across, and a wider scrollbar in them
    stubScrollbar(17);
    window.innerWidth = 1556;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(defined(config).entrySquareSize).toBe((1556 - 200 - 10 - 17) / 6);
  });
});
