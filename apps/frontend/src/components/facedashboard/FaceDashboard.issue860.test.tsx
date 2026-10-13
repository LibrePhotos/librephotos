/**
 * Repro for https://github.com/LibrePhotos/librephotos/issues/860
 *
 *   "Something similar to Google Photos, where people are represented by a cover photo of their
 *    face, and that can be expanded to reveal all the faces of that person."
 *
 * A collapsed person is one cell (their cover face, name and count) and collapsed people share
 * rows, so "Collapse all" gives a grid of people. Clicking a cell expands the person in place; the
 * expanded header shows the cover too. Clusters have no cover of their own: their first face is
 * it, so a collapsed cluster still pages in its first page.
 */
import { FaceAnalysisMethod, UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act, createRef } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletePersonFace, PersonFace } from "../../api_client/faces/types";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { calculateFaceGridCells } from "../../util/gridUtils";
import type { VirtualGridHandle } from "../virtual/VirtualGrid";
import type { FaceActionHandlers } from "./faceActionRules";
import { FacesTab } from "./facesTab";
import { isPersonCell, useVirtualizedGrid } from "./hooks/useVirtualizedGrid";
import type { GridCell } from "./hooks/useVirtualizedGrid";
import { coverFaceUrl, needsCoverPage } from "./personCover";
import { VirtualizedGridComponent } from "./VirtualizedGridComponent";

const noopMutation = vi.hoisted(() => ({ mutate: () => {} }));
// The positions each render handed the scrubber
const scrubbed = vi.hoisted(() => {
  const state: { positions: unknown[] } = { positions: [] };
  return state;
});

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => ({ tab: "inferred" }) }),
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useDeletePersonAlbumMutation: () => noopMutation,
  // Anna has a cover on the People page; clusters are not people, so they have none
  useFetchPeopleAlbumsQuery: () => ({ data: [{ id: "1", name: "Anna", face_url: "/media/faces/anna.jpg" }] }),
  useRenamePersonAlbumMutation: () => noopMutation,
}));
vi.mock("../../api_client/faces/hooks", () => ({ useSetFacesPersonLabelMutation: () => noopMutation }));
// jsdom lays nothing out: hand the grid a size, and leave the scrubber's measuring out
vi.mock("../virtual/AutoSizer", () => ({
  AutoSizer: ({ children }: { children: (size: { width: number; height: number }) => ReactNode }) =>
    children({ width: 800, height: 2000 }),
}));
vi.mock("../scrollscrubber/ScrollScrubber", () => ({
  ScrollScrubber: ({ children, scrollPositions }: { children: ReactNode; scrollPositions: unknown[] }) => {
    scrubbed.positions = scrollPositions;
    return children;
  },
}));

const loaded = (id: number): PersonFace => ({
  id,
  image: `http://backend/media/faces/${id}.jpg`,
  face_url: `/media/faces/${id}.jpg`,
  photo: "p",
  person: null,
});
const placeholder = (index: number, person: number): PersonFace => ({
  id: index,
  image: null,
  face_url: null,
  person,
  isTemp: true,
});

function group(id: number, name: string, kind: string, faces: PersonFace[]): CompletePersonFace {
  return { id, name, kind, face_count: faces.length, faces };
}

const ANNA = group(1, "Anna", "USER", [placeholder(0, 1), placeholder(1, 1)]);
const CLUSTER = group(2, "Unknown 001", "CLUSTER", [placeholder(0, 2)]);
const LOADED_CLUSTER = group(3, "Unknown 002", "CLUSTER", [loaded(31)]);
const BOB = group(4, "Bob", "USER", [loaded(41)]);
const UNKNOWN = group(0, UNKNOWN_PERSON_NAME, UNKNOWN_PERSON_NAME, [loaded(51)]);
const PEOPLE = [ANNA, CLUSTER, LOADED_CLUSTER, BOB];
const ALL = new Set(PEOPLE.map(person => person.id));
const OWN_COVERS: ReadonlyMap<number, string> = new Map([[ANNA.id, "/media/faces/anna.jpg"]]);

const names = (row: readonly GridCell[] | undefined) =>
  (row ?? []).map(cell => (isPersonCell(cell) ? cell.name : "face"));

describe("issue #860 - the grid of people", () => {
  it("puts collapsed people side by side, as many per row as faces", () => {
    const { cellContents } = calculateFaceGridCells(PEOPLE, 3, ALL);

    expect(cellContents.map(names)).toEqual([["Anna", "Unknown 001", "Unknown 002"], ["Bob"]]);
  });

  it("expands one person in place between the collapsed people around them", () => {
    const { cellContents } = calculateFaceGridCells(PEOPLE, 3, new Set([ANNA.id, LOADED_CLUSTER.id, BOB.id]));

    expect(cellContents.map(names)).toEqual([["Anna"], ["Unknown 001"], ["face"], ["Unknown 002", "Bob"]]);
  });

  it("covers a person with their own cover, a cluster with its first face", () => {
    expect(coverFaceUrl(ANNA, OWN_COVERS.get(ANNA.id))).toMatch(/\/media\/faces\/anna\.jpg$/);
    expect(coverFaceUrl(LOADED_CLUSTER, undefined)).toMatch(/\/media\/faces\/31\.jpg$/);
    // Not paged in yet, and "Unknown - Other", which is no one: the avatar's placeholder
    expect(coverFaceUrl(CLUSTER, undefined)).toBeUndefined();
    expect(coverFaceUrl(UNKNOWN, "/media/faces/x.jpg")).toBeUndefined();
  });

  it("pages in a cover only for a cluster whose first face is not loaded", () => {
    expect(needsCoverPage(CLUSTER)).toBe(true);
    expect(needsCoverPage(LOADED_CLUSTER)).toBe(false);
    expect(needsCoverPage(ANNA)).toBe(false);
    expect(needsCoverPage(UNKNOWN)).toBe(false);
  });
});

type OnSectionChange = Parameters<typeof useVirtualizedGrid>[4];

describe("issue #860 - pages a collapsed dashboard loads", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("asks only for the first page of the collapsed clusters on screen", async () => {
    const onSectionChange = vi.fn<OnSectionChange>();
    let grid: ReturnType<typeof useVirtualizedGrid> | undefined;
    function Host() {
      grid = useVirtualizedGrid(
        FacesTab.enum.inferred,
        { labeled: [], inferred: PEOPLE, unknown: [] },
        () => {},
        () => {},
        onSectionChange,
        undefined,
        () => {},
        false,
        [],
        () => {},
        FaceAnalysisMethod.enum.clustering,
        // Four people per row at this width (calculateFaceGridCellSize)
        700,
        { labeled: new Set(), inferred: ALL, unknown: new Set() }
      );
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Host />));

    await act(async () => {
      defined(grid, "the grid hook").onSectionRendered({
        rowOverscanStartIndex: 0,
        rowOverscanStopIndex: 0,
        columnOverscanStartIndex: 0,
        columnOverscanStopIndex: 3,
      });
    });

    expect(onSectionChange).toHaveBeenLastCalledWith([
      { page: 1, person: CLUSTER.id, inferred: true, method: FaceAnalysisMethod.enum.clustering },
    ]);
    await act(async () => root.unmount());
  });
});

describe("issue #860 - person cells", () => {
  const actions: FaceActionHandlers = { confirm: () => {}, rejectMatch: () => {}, labelAs: () => {}, remove: () => {} };
  let root: Root;
  let container: HTMLDivElement;
  const onToggleCollapse = vi.fn<(personId: number) => void>();

  const render = (collapsed: ReadonlySet<number>, showScrubber = true) => {
    const rows = calculateFaceGridCells(PEOPLE, 4, collapsed).cellContents;
    return act(async () =>
      root.render(
        <MantineProvider env="test">
          <VirtualizedGridComponent
            containerRef={null}
            gridRef={createRef<VirtualGridHandle>()}
            entrySquareSize={131}
            numEntrySquaresPerRow={4}
            gridHeight={rows.length * 131}
            getCellContentsForTab={() => rows}
            getScrollPositions={() => [
              { label: "Anna", targetY: 0 },
              { label: "Bob", targetY: 131 },
            ]}
            handleScrubberScroll={() => {}}
            onSectionRendered={() => {}}
            scrollPosition={undefined}
            onScroll={() => {}}
            handleCellClick={() => {}}
            handleShowClick={() => {}}
            selectMode={false}
            selectedFaces={[]}
            setSelectedFaces={() => {}}
            activeTab="inferred"
            collapsedPersons={collapsed}
            onToggleCollapse={onToggleCollapse}
            faceActions={actions}
            pendingFaceIds={new Set()}
            showScrubber={showScrubber}
          />
        </MantineProvider>
      )
    );
  };

  beforeAll(async () => {
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
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    onToggleCollapse.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const button = (label: string) =>
    defined(container.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`), `the ${label} button`);

  it("shows each collapsed person as a button with their cover, name and count", async () => {
    await render(ALL);

    const anna = button("Expand Anna");
    expect(anna.getAttribute("aria-expanded")).toBe("false");
    expect(anna.textContent).toContain("2 Faces");
    expect(anna.querySelector("img")?.getAttribute("src")).toMatch(/anna\.jpg$/);
    // The count is read out with the name
    expect(container.querySelector(`#${CSS.escape(anna.getAttribute("aria-describedby") ?? "")}`)?.textContent).toBe(
      "2 Faces"
    );
    expect(container.querySelectorAll("button[aria-label^='Expand']")).toHaveLength(PEOPLE.length);
  });

  it("expands the person in place and hands focus to their header's toggle", async () => {
    await render(ALL);
    const anna = button("Expand Anna");
    anna.focus();

    await act(async () => anna.click());
    expect(onToggleCollapse).toHaveBeenCalledWith(ANNA.id);

    // The dashboard unfolds Anna: her cell becomes a header with her cover and the faces below
    await render(new Set([CLUSTER.id, LOADED_CLUSTER.id, BOB.id]));

    const collapse = button("Collapse Anna");
    expect(document.activeElement).toBe(collapse);
    expect(collapse.parentElement?.querySelector("img")?.getAttribute("src")).toMatch(/anna\.jpg$/);
  });

  it("folds a person back into a cell that takes the focus", async () => {
    await render(new Set([CLUSTER.id, LOADED_CLUSTER.id, BOB.id]));

    await act(async () => button("Collapse Anna").click());
    expect(onToggleCollapse).toHaveBeenCalledWith(ANNA.id);
    await render(ALL);

    expect(document.activeElement).toBe(button("Expand Anna"));
  });

  it("hands the A-Z scrubber its letters only in name order (#764)", async () => {
    await render(ALL);
    expect(scrubbed.positions).toHaveLength(2);

    await render(ALL, false);
    expect(scrubbed.positions).toEqual([]);
  });
});
