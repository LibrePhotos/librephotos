import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useAlbumListGridConfig } from "../../hooks/useAlbumListGridConfig";
import { defined } from "../../util/defined.test-utils";
import { TileGrid } from "./TileGrid";
import type { TileGridSizing, TileGroup } from "./TileGrid";

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  // jsdom has no matchMedia. This one answers min-width queries from innerWidth at a 16px root
  // font size, which the album sizing asks about the theme's sm breakpoint.
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
  window.innerWidth = 1400;
  window.innerHeight = 900;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

type Item = { id: number };
const items = (count: number): Item[] => Array.from({ length: count }, (_unused, id) => ({ id }));

// Rows of 100 + 60 = 160px in a 480px viewport: three rows in view
const sizing: TileGridSizing = {
  columnCount: 4,
  columnWidth: 100,
  cellPadding: 5,
  captionHeight: 60,
  height: 480,
  gutter: 5,
};

const renderTile = (item: Item, size: number) => (
  <span data-tile={item.id} data-size={size}>
    {item.id}
  </span>
);

async function render(element: React.ReactElement) {
  await act(async () => {
    root.render(<MantineProvider>{element}</MantineProvider>);
  });
}

const tiles = () => Array.from(container.querySelectorAll<HTMLElement>("[data-tile]"));
const tileIds = () => tiles().map(tile => Number(tile.dataset.tile));
// The grid renders a scrolling <div> around a canvas <div> holding the positioned cells.
const canvas = () => {
  const element = container.querySelector("div[tabindex='0']")?.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error("the grid rendered no canvas");
  return element;
};
const cells = () => Array.from(canvas().children).filter(cell => cell instanceof HTMLElement);

describe("TileGrid", () => {
  it("mounts only the rows in view (and the overscan) of a long list", async () => {
    await render(<TileGrid items={items(1000)} getKey={item => item.id} sizing={sizing} renderItem={renderTile} />);

    expect(tiles().length).toBeGreaterThan(0);
    expect(tiles().length).toBeLessThan(100);
    expect(tileIds()).toContain(0);
    expect(tileIds()).not.toContain(999);
    // Every row is laid out for the scrollbar, mounted or not
    expect(canvas().style.height).toBe(`${250 * 160}px`);
  });

  it("puts an empty cell past the end of the last row", async () => {
    await render(<TileGrid items={items(10)} getKey={item => item.id} sizing={sizing} renderItem={renderTile} />);

    expect(tiles()).toHaveLength(10);
    // Three rows of four cells, the last two empty
    expect(cells()).toHaveLength(12);
    expect(cells().filter(cell => cell.childElementCount === 0)).toHaveLength(2);
  });

  it("hands renderItem the tile size: the column less the cell padding on both sides", async () => {
    await render(
      <TileGrid
        items={items(3)}
        getKey={item => item.id}
        sizing={sizing}
        renderItem={renderTile}
        renderCaption={item => <p data-caption={item.id}>caption</p>}
      />
    );

    expect(tiles().map(tile => tile.dataset.size)).toEqual(["90", "90", "90"]);
    // The caption sits under the padded cell, in the column's own box
    const firstCell = defined(cells()[0]);
    expect(firstCell.style.width).toBe("100px");
    expect(firstCell.style.height).toBe("160px");
    expect(firstCell.lastElementChild?.getAttribute("data-caption")).toBe("0");
  });

  it("drops the rows a shrinking list no longer fills", async () => {
    await render(<TileGrid items={items(13)} getKey={item => item.id} sizing={sizing} renderItem={renderTile} />);
    await render(<TileGrid items={items(4)} getKey={item => item.id} sizing={sizing} renderItem={renderTile} />);

    expect(tiles()).toHaveLength(4);
    expect(canvas().style.height).toBe("160px");
  });

  it("puts a header row of its own height before each group", async () => {
    const groups: TileGroup<Item>[] = [
      { key: "a", header: <h3>Alice</h3>, items: items(5) },
      { key: "b", header: <h3>Bob</h3>, items: items(3).map(item => ({ id: item.id + 100 })) },
    ];
    await render(
      <TileGrid groups={groups} headerHeight={50} getKey={item => item.id} sizing={sizing} renderItem={renderTile} />
    );

    const headers = Array.from(container.querySelectorAll("h3"), header => defined(header.parentElement));
    expect(headers.map(header => header.textContent)).toEqual(["Alice", "Bob"]);
    // Across every column, at the top of its row: Alice's header and two rows of hers above Bob's
    expect(headers.map(header => header.style.width)).toEqual(["400px", "400px"]);
    expect(headers.map(header => header.style.top)).toEqual(["0px", `${50 + 2 * 160}px`]);
    expect(tileIds()).toEqual([0, 1, 2, 3, 4, 100, 101, 102]);
  });

  function AlbumGrid({ count }: { count: number }) {
    return (
      <TileGrid
        items={items(count)}
        getKey={item => item.id}
        sizing={useAlbumListGridConfig()}
        renderItem={renderTile}
      />
    );
  }

  const columns = () => new Set(tiles().map(tile => tile.closest<HTMLElement>("[style*='left']")?.style.left)).size;

  it("takes the column count from the width with the album sizing", async () => {
    await render(<AlbumGrid count={30} />);
    expect(columns()).toBe(6);

    // A phone: two columns, no navbar
    window.innerWidth = 375;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(columns()).toBe(2);
  });
});
