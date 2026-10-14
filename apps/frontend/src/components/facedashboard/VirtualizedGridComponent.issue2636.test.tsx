/**
 * A face without a crop (legacy rows, or a crop that failed to save) comes from the face list with
 * `image` and `face_url` null since #2632. The grid took null for "not paged in yet" and rendered an
 * empty cell, so the face could never be selected, relabelled or deleted. It is a tile like any
 * other face now, with a placeholder instead of the crop.
 */
import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { flatten } from "lodash-es";
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
import { useFaceSelection } from "./hooks/useFaceSelection";
import type { FaceCell, FaceSelection, GridCell, GridRows } from "./hooks/useVirtualizedGrid";
import { VirtualizedGridComponent } from "./VirtualizedGridComponent";

const noopMutation = vi.hoisted(() => ({ mutate: () => {} }));

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => ({ tab: "inferred" }) }),
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useDeletePersonAlbumMutation: () => noopMutation,
  useFetchPeopleAlbumsQuery: () => ({ data: [] }),
  useRenamePersonAlbumMutation: () => noopMutation,
}));
vi.mock("../../api_client/faces/hooks", () => ({
  useSetFacesPersonLabelMutation: () => noopMutation,
  useRestoreFacesMutation: () => noopMutation,
}));
vi.mock("../virtual/AutoSizer", () => ({
  AutoSizer: ({ children }: { children: (size: { width: number; height: number }) => ReactNode }) =>
    children({ width: 800, height: 2000 }),
}));
vi.mock("../scrollscrubber/ScrollScrubber", () => ({
  ScrollScrubber: ({ children }: { children: ReactNode }) => children,
}));

const withCrop = (id: number): PersonFace => ({ id, image: `/${id}.jpg`, face_url: `/${id}.jpg`, photo: "p" });
// What the face list sends for a face whose crop is missing (#2632)
const cropless = (id: number): PersonFace => ({ id, image: null, face_url: null, photo: `photo${id}` });

const group = (id: number, name: string, kind: string, faces: PersonFace[]): CompletePersonFace => ({
  id,
  name,
  kind,
  face_count: faces.length,
  faces,
});

const LIST = [
  group(1, "Anna", "USER", [withCrop(11), cropless(12), cropless(13)]),
  group(0, UNKNOWN_PERSON_NAME, UNKNOWN_PERSON_NAME, [cropless(31)]),
];
const ROWS: GridRows = calculateFaceGridCells(LIST, 4, new Set()).cellContents;
const CELLS = flatten<GridCell>(ROWS);

const stubs = vi.hoisted(() => ({ remove: vi.fn<(face: { id: number }) => void>() }));
const actions: FaceActionHandlers = {
  confirm: () => {},
  rejectMatch: () => {},
  labelAs: () => {},
  remove: face => stubs.remove(face),
  restore: () => {},
};

let selection: FaceSelection[] = [];

// FaceDashboard's wiring of the selection
function Harness() {
  const { selectedFaces, setSelectedFaces, handleCellClick } = useFaceSelection((start: FaceCell, end: FaceCell) => {
    const [from, to] = [CELLS.indexOf(start), CELLS.indexOf(end)].sort((a, b) => a - b);
    return CELLS.slice(from, (to ?? 0) + 1);
  });
  selection = selectedFaces;
  return (
    <VirtualizedGridComponent
      containerRef={null}
      gridRef={createRef<VirtualGridHandle>()}
      entrySquareSize={131}
      numEntrySquaresPerRow={4}
      gridHeight={ROWS.length * 131}
      getCellContentsForTab={() => ROWS}
      getScrollPositions={() => []}
      handleScrubberScroll={() => {}}
      onSectionRendered={() => {}}
      scrollPosition={undefined}
      onScroll={() => {}}
      handleCellClick={handleCellClick}
      handleShowClick={() => {}}
      selectMode={selectedFaces.length > 0}
      selectedFaces={selectedFaces}
      setSelectedFaces={setSelectedFaces}
      activeTab="inferred"
      collapsedPersons={new Set()}
      onToggleCollapse={() => {}}
      faceActions={actions}
      pendingFaceIds={new Set()}
      showScrubber
    />
  );
}

let root: Root;
let container: HTMLDivElement;

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

beforeEach(async () => {
  selection = [];
  stubs.remove.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MantineProvider env="test">
        <Harness />
      </MantineProvider>
    )
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const faceButtons = (name: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>(`button[aria-label^='Face in ${name}']`));

describe("a face without a crop on the faces dashboard", () => {
  it("is a face tile with its buttons, like a face with a crop", () => {
    expect(faceButtons("Anna").map(button => button.getAttribute("aria-label"))).toEqual([
      "Face in Anna",
      "Face in Anna (no face thumbnail)",
      "Face in Anna (no face thumbnail)",
    ]);
    expect(faceButtons(UNKNOWN_PERSON_NAME)).toHaveLength(1);
    expect(container.querySelectorAll("button[aria-label^='Face actions']")).toHaveLength(4);
  });

  it("can be deleted from its menu", async () => {
    const menus = container.querySelectorAll<HTMLButtonElement>("button[aria-label='Face actions (Anna)']");
    await act(async () => defined(menus[1]).click());
    const deleteItem = Array.from(container.querySelectorAll<HTMLButtonElement>("[role=menuitem]")).find(
      item => item.textContent === "Delete face"
    );
    await act(async () => defined(deleteItem).click());

    expect(stubs.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }));
  });

  it("can be selected, and two of them are two faces", async () => {
    const [, first, second] = faceButtons("Anna");
    await act(async () => defined(first).click());
    await act(async () => defined(second).click());

    expect(selection.map(face => face.face_id)).toEqual([12, 13]);
    expect(defined(first).getAttribute("aria-pressed")).toBe("true");
    expect(defined(second).getAttribute("aria-pressed")).toBe("true");
  });

  it("is part of a shift-click range", async () => {
    const [withImage] = faceButtons("Anna");
    const [unknown] = faceButtons(UNKNOWN_PERSON_NAME);
    await act(async () => defined(withImage).click());
    await act(async () => defined(unknown).dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })));

    expect(selection.map(face => face.face_id).sort()).toEqual([11, 12, 13, 31]);
  });

  it("is selected with its person's name chip", async () => {
    const chip = defined(container.querySelector<HTMLInputElement>("input[type='checkbox']"));
    await act(async () => chip.click());

    expect(selection.map(face => face.face_id).sort()).toEqual([11, 12, 13]);
  });
});
