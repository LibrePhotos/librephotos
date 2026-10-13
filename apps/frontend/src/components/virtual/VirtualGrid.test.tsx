import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { AutoSizer } from "./AutoSizer";
import { sectionBounds, withPinnedRow } from "./useGridFocus";
import { VirtualGrid } from "./VirtualGrid";
import type { GridCellProps, GridScrollParams, SectionRenderedParams, VirtualGridHandle } from "./VirtualGrid";

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
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
});

function renderCell({ rowIndex, columnIndex, key, style }: GridCellProps) {
  return (
    <div key={key} data-cell={`${rowIndex}:${columnIndex}`} style={style}>
      {rowIndex}:{columnIndex}
    </div>
  );
}

type GridProps = React.ComponentProps<typeof VirtualGrid>;

async function renderGrid(props: Partial<GridProps> = {}, ref?: React.Ref<VirtualGridHandle>) {
  await act(async () => {
    root.render(
      <VirtualGrid
        ref={ref}
        cellRenderer={renderCell}
        columnCount={4}
        columnWidth={50}
        rowCount={1000}
        rowHeight={100}
        height={300}
        overscanRowCount={2}
        {...props}
      />
    );
  });
}

// The grid renders a scrolling <div> around a canvas <div>.
function divOf(element: Element | null): HTMLDivElement {
  if (!(element instanceof HTMLDivElement)) throw new Error("expected a <div>");
  return element;
}
const scroller = () => divOf(container.firstElementChild);
const inner = () => divOf(scroller().firstElementChild);
const renderedRows = () => [
  ...new Set(
    Array.from(container.querySelectorAll("[data-cell]"), cell =>
      Number(defined(cell.getAttribute("data-cell")).split(":")[0])
    )
  ),
];

async function scrollTo(scrollTop: number) {
  await act(async () => {
    scroller().scrollTop = scrollTop;
    scroller().dispatchEvent(new Event("scroll"));
  });
}

describe("VirtualGrid", () => {
  it("renders every column of only the rows in view plus the overscan", async () => {
    await renderGrid();

    // 300px of 100px rows shows rows 0-2; two rows of overscan below
    expect(renderedRows()).toEqual([0, 1, 2, 3, 4]);
    expect(container.querySelectorAll("[data-cell]")).toHaveLength(5 * 4);
    // ...inside a canvas as large as the whole grid, so the scrollbar is right
    expect(inner().style.height).toBe("100000px");
    expect(inner().style.width).toBe("200px");
  });

  it("positions each cell at its row offset and column", async () => {
    await renderGrid();

    const cell = divOf(container.querySelector('[data-cell="3:2"]'));
    expect(cell.style.position).toBe("absolute");
    expect(cell.style.top).toBe("300px");
    expect(cell.style.left).toBe("100px");
    expect(cell.style.width).toBe("50px");
    expect(cell.style.height).toBe("100px");
  });

  it("moves the rendered rows with the scroll position and reports them", async () => {
    const onScroll = vi.fn<(params: GridScrollParams) => void>();
    const onSectionRendered = vi.fn<(params: SectionRenderedParams) => void>();
    await renderGrid({ onScroll, onSectionRendered });
    expect(onSectionRendered).toHaveBeenLastCalledWith({
      rowOverscanStartIndex: 0,
      rowOverscanStopIndex: 4,
      columnOverscanStartIndex: 0,
      columnOverscanStopIndex: 3,
    });

    await scrollTo(5000);

    expect(renderedRows()).toEqual([48, 49, 50, 51, 52, 53, 54]);
    expect(onScroll).toHaveBeenLastCalledWith(expect.objectContaining({ scrollTop: 5000 }));
    expect(onSectionRendered).toHaveBeenLastCalledWith({
      rowOverscanStartIndex: 48,
      rowOverscanStopIndex: 54,
      columnOverscanStartIndex: 0,
      columnOverscanStopIndex: 3,
    });
  });

  it("reports a section once, not on every render", async () => {
    const onSectionRendered = vi.fn<(params: SectionRenderedParams) => void>();
    await renderGrid({ onSectionRendered });
    await renderGrid({ onSectionRendered, cellRenderer: props => renderCell(props) });

    expect(onSectionRendered).toHaveBeenCalledTimes(1);
  });

  it("applies a scrollTop prop on mount and when it changes (restoring a tab's position)", async () => {
    await renderGrid({ scrollTop: 1200 });
    expect(scroller().scrollTop).toBe(1200);

    await renderGrid({ scrollTop: 400 });
    expect(scroller().scrollTop).toBe(400);
  });

  it("scrolls imperatively for the scroll scrubber", async () => {
    const ref = createRef<VirtualGridHandle>();
    await renderGrid({}, ref);

    await act(async () => {
      defined(ref.current).scrollToPosition({ scrollTop: 2500 });
    });

    expect(scroller().scrollTop).toBe(2500);
  });

  it("re-lays out the rows when the row height changes", async () => {
    await renderGrid();
    await renderGrid({ rowHeight: 50 });

    expect(inner().style.height).toBe("50000px");
    expect(divOf(container.querySelector('[data-cell="3:0"]')).style.top).toBe("150px");
    // 300px of 50px rows shows rows 0-5
    expect(renderedRows()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("supports variable row heights", async () => {
    const rowHeight = ({ index }: { index: number }) => (index % 2 === 0 ? 70 : 200);
    await renderGrid({ rowHeight, rowCount: 10 });

    expect(inner().style.height).toBe(`${5 * 70 + 5 * 200}px`);
    expect(divOf(container.querySelector('[data-cell="2:0"]')).style.top).toBe("270px");
  });

  it("shows more rows when the viewport grows", async () => {
    await renderGrid();
    await renderGrid({ height: 600 });

    expect(renderedRows()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("renders the last column of a column count computed a hair below an integer", async () => {
    await renderGrid({ columnCount: 3 - 1e-12, rowCount: 1 });

    expect(container.querySelectorAll("[data-cell]")).toHaveLength(3);
  });

  it("is keyboard focusable so the arrow and page keys scroll it", async () => {
    await renderGrid();

    expect(scroller().tabIndex).toBe(0);
  });

  it("renders nothing for an empty grid", async () => {
    const onSectionRendered = vi.fn<(params: SectionRenderedParams) => void>();
    await renderGrid({ rowCount: 0, onSectionRendered });

    expect(container.querySelectorAll("[data-cell]")).toHaveLength(0);
    expect(onSectionRendered).not.toHaveBeenCalled();
  });
});

/** A cell with a button in it, as the faces grid has. */
function renderFocusableCell({ rowIndex, columnIndex, key, style }: GridCellProps) {
  return (
    <div key={key} data-cell={`${rowIndex}:${columnIndex}`} style={style}>
      <button type="button">{`${rowIndex}:${columnIndex}`}</button>
    </div>
  );
}

const cellButton = (cell: string) =>
  defined(container.querySelector<HTMLButtonElement>(`[data-cell="${cell}"] button`));

describe("VirtualGrid keepFocusedRowMounted (the faces grid's menus and buttons)", () => {
  it("keeps the row with keyboard focus rendered after it scrolls out of view", async () => {
    await renderGrid({ cellRenderer: renderFocusableCell, keepFocusedRowMounted: true });
    const button = cellButton("1:2");
    await act(async () => button.focus());

    await scrollTo(5000);

    expect(renderedRows()).toEqual([1, 48, 49, 50, 51, 52, 53, 54]);
    expect(document.activeElement).toBe(button);
  });

  it("does not stretch the reported section to the far-away focused row", async () => {
    const onSectionRendered = vi.fn<(params: SectionRenderedParams) => void>();
    await renderGrid({ cellRenderer: renderFocusableCell, keepFocusedRowMounted: true, onSectionRendered });
    await act(async () => cellButton("1:0").focus());

    await scrollTo(5000);

    expect(onSectionRendered).toHaveBeenLastCalledWith(
      expect.objectContaining({ rowOverscanStartIndex: 48, rowOverscanStopIndex: 54 })
    );
  });

  it("lets every other grid unmount rows as before", async () => {
    await renderGrid({ cellRenderer: renderFocusableCell });
    await act(async () => cellButton("1:2").focus());

    await scrollTo(5000);

    expect(renderedRows()).toEqual([48, 49, 50, 51, 52, 53, 54]);
  });

  it("puts focus on the same control of the content that replaces the focused cell's", async () => {
    // "face" n of the cell: a confirmed face leaves, a placeholder stands in, the next face loads
    const cellOf = (content: "a" | "placeholder" | "b") => (props: GridCellProps) =>
      props.rowIndex === 1 && props.columnIndex === 0 ? (
        <div key={props.key} data-cell="1:0" style={props.style}>
          {content !== "placeholder" && (
            <button key={content} type="button" data-focus-key="confirm">
              {content}
            </button>
          )}
        </div>
      ) : (
        renderFocusableCell(props)
      );
    await renderGrid({ cellRenderer: cellOf("a"), keepFocusedRowMounted: true });
    await act(async () => cellButton("1:0").focus());

    await renderGrid({ cellRenderer: cellOf("placeholder"), keepFocusedRowMounted: true });
    expect(document.activeElement).toBe(document.body);
    await renderGrid({ cellRenderer: cellOf("b"), keepFocusedRowMounted: true });

    expect(document.activeElement?.textContent).toBe("b");
  });

  it("leaves focus alone once the user has moved it elsewhere", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const withButton = (shown: boolean) => (props: GridCellProps) =>
      props.rowIndex === 1 && props.columnIndex === 0 ? (
        <div key={props.key} data-cell="1:0" style={props.style}>
          {shown && <button type="button" data-focus-key="confirm" />}
        </div>
      ) : (
        renderFocusableCell(props)
      );
    await renderGrid({ cellRenderer: withButton(true), keepFocusedRowMounted: true });
    await act(async () => cellButton("1:0").focus());
    await renderGrid({ cellRenderer: withButton(false), keepFocusedRowMounted: true });

    await act(async () => outside.focus());
    await renderGrid({ cellRenderer: withButton(true), keepFocusedRowMounted: true });

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("adds a pinned row to the rendered rows in order, once", () => {
    expect(withPinnedRow([5, 6, 7], 1, 100)).toEqual([1, 5, 6, 7]);
    expect(withPinnedRow([5, 6, 7], 6, 100)).toEqual([5, 6, 7]);
    expect(withPinnedRow([5, 6, 7], null, 100)).toEqual([5, 6, 7]);
    // The focused row is gone (the list shrank): nothing to keep
    expect(withPinnedRow([5, 6, 7], 120, 100)).toEqual([5, 6, 7]);
  });

  it("reports the rendered rows' bounds, with a pinned row only when it touches them", () => {
    expect(sectionBounds([1, 48, 49, 50], 1)).toEqual([48, 50]);
    expect(sectionBounds([47, 48, 49, 50], 47)).toEqual([47, 50]);
    expect(sectionBounds([48, 49, 50, 51], 51)).toEqual([48, 51]);
    expect(sectionBounds([48, 49, 50], null)).toEqual([48, 50]);
    expect(sectionBounds([3], 3)).toEqual([3, 3]);
    expect(sectionBounds([], null)).toEqual([-1, -1]);
  });
});

describe("AutoSizer", () => {
  it("hands its children the parent's content box and takes no space itself", async () => {
    const parent = document.createElement("div");
    parent.style.padding = "0px 15px";
    Object.defineProperty(parent, "offsetWidth", { configurable: true, value: 830 });
    Object.defineProperty(parent, "offsetHeight", { configurable: true, value: 640 });
    container.appendChild(parent);
    const parentRoot = createRoot(parent);
    const sizes: Array<{ width: number; height: number }> = [];

    await act(async () => {
      parentRoot.render(
        <AutoSizer>
          {size => {
            sizes.push(size);
            return <span>sized</span>;
          }}
        </AutoSizer>
      );
    });

    expect(sizes.at(-1)).toEqual({ width: 800, height: 640 });
    const box = divOf(parent.firstElementChild);
    expect(box.style.width).toBe("0px");
    expect(box.style.height).toBe("0px");

    await act(async () => {
      parentRoot.unmount();
    });
  });

  it("renders nothing while the parent has no size", async () => {
    await act(async () => {
      root.render(<AutoSizer>{() => <span>sized</span>}</AutoSizer>);
    });

    expect(container.textContent).toBe("");
  });
});
