import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FacesTab } from "../../../api_client/faces";
import { useContentBoxSize } from "../../virtual/useContentBoxSize";
import classes from "../VirtualizedGridComponent.module.css";
import { useVirtualizedGrid } from "./useVirtualizedGrid";

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  // The faces container is 1200px wide including its 15px side padding
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(700);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

const noop = () => {};
const lists = { labeled: [], inferred: [], unknown: [] };
const collapsed = { labeled: new Set<number>(), inferred: new Set<number>(), unknown: new Set<number>() };

let layout: { width: number; columns: number; cellSize: number } | undefined;

// FaceDashboard's wiring: the container's measured width drives the grid's column count
function Harness() {
  const { ref, width } = useContentBoxSize<HTMLDivElement>();
  const grid = useVirtualizedGrid(
    FacesTab.enum.labeled,
    lists,
    noop,
    noop,
    noop,
    undefined,
    noop,
    false,
    [],
    noop,
    "clustering",
    width,
    collapsed
  );
  layout = { width, columns: grid.numEntrySquaresPerRow, cellSize: grid.entrySquareSize };
  return <div ref={ref} className={classes.container} style={{ padding: "0px 15px" }} />;
}

describe("faces grid sizing", () => {
  it("fits every column inside the padded container's content box", async () => {
    await act(async () => {
      root.render(<Harness />);
    });

    expect(layout!.width).toBe(1170);
    expect(layout!.columns).toBe(8);
    expect(layout!.columns * layout!.cellSize).toBeLessThanOrEqual(1170);
  });
});
