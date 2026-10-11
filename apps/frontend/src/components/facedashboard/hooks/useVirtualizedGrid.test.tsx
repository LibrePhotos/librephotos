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

    if (!layout) throw new Error("the grid did not render");
    expect(layout.width).toBe(1170);
    expect(layout.columns).toBe(8);
    expect(layout.columns * layout.cellSize).toBeLessThanOrEqual(1170);
  });
});

type SectionInfos = Parameters<Parameters<typeof useVirtualizedGrid>[4]>[0];

// A person whose faces have not been paged in yet: placeholders with their index as the id
const unloadedPerson = (id: number, faceCount: number) => ({
  id,
  name: `Person ${id}`,
  kind: "USER",
  face_count: faceCount,
  faces: Array.from({ length: faceCount }, (_unused, index) => ({
    id: index,
    image: null,
    face_url: null,
    photo: "",
    person_label_probability: 0,
    isTemp: true,
    person: id,
  })),
});

describe("paging in the faces a fold reveals", () => {
  const onSectionChange = vi.fn<(infos: SectionInfos) => void>();
  let grid: ReturnType<typeof useVirtualizedGrid> | undefined;

  function PagingHarness({
    people,
    collapsedPersons,
  }: Readonly<{
    people: ReturnType<typeof unloadedPerson>[];
    collapsedPersons: Record<FacesTab, ReadonlySet<number>>;
  }>) {
    grid = useVirtualizedGrid(
      FacesTab.enum.labeled,
      { labeled: people, inferred: [], unknown: [] },
      noop,
      noop,
      onSectionChange,
      undefined,
      noop,
      false,
      [],
      noop,
      "clustering",
      1170,
      collapsedPersons
    );
    return null;
  }

  const render = async (people: ReturnType<typeof unloadedPerson>[], collapsedPersons = collapsed) => {
    await act(async () => {
      root.render(<PagingHarness people={people} collapsedPersons={collapsedPersons} />);
    });
  };

  beforeEach(() => {
    onSectionChange.mockReset();
    grid = undefined;
  });

  it("replays the last section on a fold, and only on a fold", async () => {
    const people = [unloadedPerson(1, 2), unloadedPerson(2, 2)];
    await render(people);
    // Nothing has been rendered yet, so there is nothing to replay
    expect(onSectionChange).not.toHaveBeenCalled();

    // Rows: [person 1], [its 2 faces], [person 2], [its 2 faces]; rows 0-2 show person 1's faces
    act(() => {
      grid?.onSectionRendered({
        rowOverscanStartIndex: 0,
        rowOverscanStopIndex: 2,
        columnOverscanStartIndex: 0,
        columnOverscanStopIndex: 7,
      });
    });
    expect(onSectionChange).toHaveBeenCalledTimes(1);
    expect(onSectionChange).toHaveBeenLastCalledWith([{ page: 1, person: 1, inferred: false, method: "clustering" }]);

    // Folding person 1 moves person 2's faces into the same rows; the Grid reports nothing
    await render(people, { ...collapsed, labeled: new Set([1]) });
    expect(onSectionChange).toHaveBeenCalledTimes(2);
    expect(onSectionChange).toHaveBeenLastCalledWith([{ page: 1, person: 2, inferred: false, method: "clustering" }]);

    // Data arriving is not a fold: the pages that just landed are not requested again
    const foldedOne = { ...collapsed, labeled: new Set([1]) };
    await render(people, foldedOne);
    onSectionChange.mockReset();
    await render([unloadedPerson(1, 2), unloadedPerson(2, 2)], foldedOne);
    expect(onSectionChange).not.toHaveBeenCalled();
  });
});
