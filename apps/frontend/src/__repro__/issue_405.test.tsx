/**
 * Repro for https://github.com/LibrePhotos/librephotos/issues/405
 *
 *   "Let each person group on the faces page fold/unfold, so long face lists can be
 *    collapsed to just the name."
 *
 * The faces page is a `react-virtualized` Grid with a constant `rowHeight`. Its row
 * count, its scroll scrubber and its lazy page loader all read the same flattened cell
 * array that `calculateFaceGridCells` builds, so folding a group has to happen there:
 * hiding the face rows in the DOM would leave the grid claiming rows that render nothing.
 *
 * A collapsed person must therefore contribute exactly one row (its header) instead of
 * `1 + ceil(faces / itemsPerRow)`, and its placeholder faces must disappear from the
 * flattened array - otherwise `onSectionRendered` keeps requesting pages of faces that
 * nobody can see.
 *
 * The Grid memoizes `onSectionRendered` on its overscan index range, so a fold - which moves
 * cells behind a range that does not itself move - has to re-request the newly revealed pages
 * on its own, or the faces it uncovers stay blank until the next scroll.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FaceAnalysisMethod, FacesTab } from "../api_client/faces/types";
import { HeaderComponent } from "../components/facedashboard/HeaderComponent";
import { useCollapsedPersons } from "../components/facedashboard/hooks/useCollapsedPersons";
import { useVirtualizedGrid } from "../components/facedashboard/hooks/useVirtualizedGrid";
import i18n from "../i18n";
import { calculateFaceGridCells } from "../util/gridUtils";

const stubs = vi.hoisted(() => ({
  noopMutation: { mutate: () => {}, mutateAsync: async () => {}, isPending: false },
}));

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => ({ tab: "labeled" }) }),
}));
vi.mock("../api_client/albums/hooks", () => ({
  useDeletePersonAlbumMutation: () => stubs.noopMutation,
  useFetchPeopleAlbumsQuery: () => ({ data: [] }),
  useRenamePersonAlbumMutation: () => stubs.noopMutation,
}));
vi.mock("../api_client/faces/hooks", () => ({
  useSetFacesPersonLabelMutation: () => stubs.noopMutation,
}));

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

/** A person as `/faces/incomplete/` delivers it: face_count placeholders, no images yet. */
function person(id: number, name: string, faceCount: number) {
  return {
    id,
    name,
    kind: "USER",
    face_count: faceCount,
    faces: Array.from({ length: faceCount }, (unused, idx) => ({
      id: idx,
      image: null,
      face_url: null,
      photo: "",
      person_label_probability: 1,
      person: id,
      isTemp: true,
    })),
  };
}

const ITEMS_PER_ROW = 4;
// calculateFaceGridCellSize puts ITEMS_PER_ROW faces in a row at this width
const GRID_WIDTH = 700;
const PEOPLE = [person(1, "Alice", 9), person(2, "Bob", 5)];
const LISTS = { labeled: PEOPLE, inferred: [], unknown: [] };
const NOTHING_COLLAPSED: Record<FacesTab, ReadonlySet<number>> = {
  labeled: new Set<number>(),
  inferred: new Set<number>(),
  unknown: new Set<number>(),
};

async function renderHeader(
  cell: any,
  isCollapsed: boolean,
  onToggleCollapse: () => void,
  setSelectedFaces: (faces: any[]) => void = () => {}
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <HeaderComponent
          cell={cell}
          style={{}}
          selectedFaces={[]}
          setSelectedFaces={setSelectedFaces}
          isCollapsed={isCollapsed}
          onToggleCollapse={onToggleCollapse}
        />
      </MantineProvider>
    );
  });
  const toggle = container.querySelector<HTMLButtonElement>("button[aria-expanded]");
  return {
    toggle,
    selectAll: container.querySelector<HTMLInputElement>("input[type='checkbox']"),
    text: container.textContent ?? "",
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

type SectionRequest = { page: number; person: number };

function GridHost({
  collapsedPersons,
  onSectionChange,
  onRender,
}: Readonly<{
  collapsedPersons: Record<FacesTab, ReadonlySet<number>>;
  onSectionChange: (requests: SectionRequest[]) => void;
  onRender: (grid: ReturnType<typeof useVirtualizedGrid>) => void;
}>) {
  onRender(
    useVirtualizedGrid(
      FacesTab.enum.labeled,
      LISTS,
      () => {},
      () => {},
      onSectionChange as any,
      undefined,
      () => {},
      false,
      [],
      () => {},
      FaceAnalysisMethod.enum.clustering,
      GRID_WIDTH,
      collapsedPersons
    )
  );
  return null;
}

async function renderGrid(onSectionChange: (requests: SectionRequest[]) => void) {
  const container = document.createElement("div");
  const root = createRoot(container);
  let grid: any;
  const render = (collapsedPersons: Record<FacesTab, ReadonlySet<number>>) =>
    act(async () => {
      root.render(
        <GridHost
          collapsedPersons={collapsedPersons}
          onSectionChange={onSectionChange}
          onRender={value => {
            grid = value;
          }}
        />
      );
    });

  await render(NOTHING_COLLAPSED);
  return {
    get grid() {
      return grid;
    },
    render,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

async function renderCollapsedPersons() {
  const container = document.createElement("div");
  const root = createRoot(container);
  let hook: any;
  function Host() {
    hook = useCollapsedPersons();
    return null;
  }
  await act(async () => {
    root.render(<Host />);
  });
  return {
    get hook() {
      return hook;
    },
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

describe("issue #405 - fold/unfold person groups on the faces page", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("gives an expanded person a header row plus a row per face batch", () => {
    const { cellContents } = calculateFaceGridCells(PEOPLE, ITEMS_PER_ROW);

    expect(cellContents).toHaveLength(1 + Math.ceil(9 / ITEMS_PER_ROW) + 1 + Math.ceil(5 / ITEMS_PER_ROW));
  });

  it("reduces a collapsed person to its header row alone", () => {
    const { cellContents } = calculateFaceGridCells(PEOPLE, ITEMS_PER_ROW, new Set([1]));

    expect(cellContents).toHaveLength(1 + 1 + Math.ceil(5 / ITEMS_PER_ROW));
    // Bob's header follows Alice's immediately - no empty rows left behind
    expect(cellContents[0][0].name).toBe("Alice");
    expect(cellContents[1][0].name).toBe("Bob");
  });

  it("keeps every person reachable when all groups are collapsed", () => {
    const { cellContents } = calculateFaceGridCells(PEOPLE, ITEMS_PER_ROW, new Set([1, 2]));

    expect(cellContents).toHaveLength(PEOPLE.length);
    expect(cellContents.map(row => row[0].name)).toEqual(["Alice", "Bob"]);
  });

  it("stops the lazy loader from paging in the faces of a collapsed person", () => {
    const { cellContents } = calculateFaceGridCells(PEOPLE, ITEMS_PER_ROW, new Set([1]));

    // onSectionRendered only asks the API for cells that are both visible and isTemp
    const pagedPersons = cellContents.flat().filter((cell: any) => cell.isTemp);

    expect(new Set(pagedPersons.map((cell: any) => cell.person))).toEqual(new Set([2]));
  });

  it("shows the face count and an expandable toggle while collapsed", async () => {
    const toggled: number[] = [];
    const { toggle, text, cleanup } = await renderHeader(PEOPLE[0], true, () => toggled.push(PEOPLE[0].id));

    // Collapsed, the count is the only remaining signal of how big the group is
    expect(text).toContain("9 Faces");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.getAttribute("aria-label")).toBe("Expand Alice");

    await act(async () => {
      toggle?.click();
    });
    expect(toggled).toEqual([PEOPLE[0].id]);

    await cleanup();
  });

  it("labels the toggle as collapsible while expanded", async () => {
    const { toggle, cleanup } = await renderHeader(PEOPLE[0], false, () => {});

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(toggle?.getAttribute("aria-label")).toBe("Collapse Alice");

    await cleanup();
  });

  it("selects only the faces of a group that have been paged in", async () => {
    // A group whose first face arrived, while the rest are still placeholders carrying their
    // index as id - selecting those would act on whatever real faces own ids 1 and 2
    const alice = person(1, "Alice", 3);
    alice.faces[0] = { ...alice.faces[0], id: 4711, face_url: "/media/faces/4711.jpg", isTemp: false } as any;
    const selections: any[][] = [];
    const { selectAll, cleanup } = await renderHeader(
      alice,
      false,
      () => {},
      faces => selections.push(faces)
    );

    await act(async () => {
      selectAll?.click();
    });

    expect(selections).toEqual([[{ face_id: 4711, face_url: "/media/faces/4711.jpg" }]]);

    await cleanup();
  });

  it("shrinks the grid and re-requests the pages a fold reveals", async () => {
    const requests: SectionRequest[][] = [];
    const view = await renderGrid(infos => requests.push(infos));

    expect(view.grid.getCellContentsForTab(FacesTab.enum.labeled)).toHaveLength(
      1 + Math.ceil(9 / ITEMS_PER_ROW) + 1 + Math.ceil(5 / ITEMS_PER_ROW)
    );

    // The viewport covers the first three rows, all of them Alice's
    await act(async () => {
      view.grid.onSectionRendered({
        rowOverscanStartIndex: 0,
        columnOverscanStartIndex: 0,
        rowOverscanStopIndex: 2,
        columnOverscanStopIndex: ITEMS_PER_ROW - 1,
      });
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].map(request => request.person)).toEqual([1]);

    // Folding Alice pulls Bob's faces into those same rows without moving the row range
    await view.render({ ...NOTHING_COLLAPSED, labeled: new Set([1]) });

    expect(view.grid.getCellContentsForTab(FacesTab.enum.labeled)).toHaveLength(1 + 1 + Math.ceil(5 / ITEMS_PER_ROW));
    expect(view.grid.gridHeight).toBe(4 * (GRID_WIDTH / ITEMS_PER_ROW));
    expect(requests).toHaveLength(2);
    expect(requests[1].map(request => request.person)).toEqual([2]);

    await view.cleanup();
  });

  it("restores folded groups from localStorage and writes toggles back", async () => {
    localStorage.setItem("faceCollapsedPersons", JSON.stringify({ labeled: [7], inferred: [], unknown: [] }));
    const view = await renderCollapsedPersons();

    expect(view.hook.collapsedPersons.labeled).toEqual(new Set([7]));

    await act(async () => {
      view.hook.toggleCollapsed(FacesTab.enum.labeled, 9);
    });

    expect(view.hook.collapsedPersons.labeled).toEqual(new Set([7, 9]));
    expect(JSON.parse(localStorage.getItem("faceCollapsedPersons") ?? "{}")).toEqual({
      labeled: [7, 9],
      inferred: [],
      unknown: [],
    });

    await view.cleanup();
  });

  it("falls back to nothing folded when the stored value is not a list of person ids", async () => {
    localStorage.setItem("faceCollapsedPersons", JSON.stringify({ labeled: 5 }));
    const view = await renderCollapsedPersons();

    expect(view.hook.collapsedPersons.labeled).toEqual(new Set());
    expect(view.hook.collapsedPersons.unknown).toEqual(new Set());

    await view.cleanup();
  });
});
