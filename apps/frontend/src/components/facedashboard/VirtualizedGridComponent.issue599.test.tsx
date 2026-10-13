/**
 * The faces grid hands each face the group it is shown in (#599): Confirm only for a named
 * person's face, no buttons at all on a face whose page has not loaded yet.
 */
import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act, createRef } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletePersonFace, PersonFace } from "../../api_client/faces/types";
import i18n from "../../i18n";
import { calculateFaceGridCells } from "../../util/gridUtils";
import type { VirtualGridHandle } from "../virtual/VirtualGrid";
import type { FaceActionHandlers } from "./faceActionRules";
import type { GridRows } from "./hooks/useVirtualizedGrid";
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
vi.mock("../../api_client/faces/hooks", () => ({ useSetFacesPersonLabelMutation: () => noopMutation }));
// jsdom lays nothing out: hand the grid a size, and leave the scrubber's measuring out
vi.mock("../virtual/AutoSizer", () => ({
  AutoSizer: ({ children }: { children: (size: { width: number; height: number }) => ReactNode }) =>
    children({ width: 800, height: 2000 }),
}));
vi.mock("../scrollscrubber/ScrollScrubber", () => ({
  ScrollScrubber: ({ children }: { children: ReactNode }) => children,
}));

const loaded = (id: number): PersonFace => ({
  id,
  image: `/${id}.jpg`,
  face_url: `/${id}.jpg`,
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

const LIST = [
  group(1, "Anna", "USER", [loaded(11), placeholder(1, 1)]),
  group(2, "Unknown 001", "CLUSTER", [loaded(21)]),
  group(0, UNKNOWN_PERSON_NAME, UNKNOWN_PERSON_NAME, [loaded(31)]),
];
const ROWS: GridRows = calculateFaceGridCells(LIST, 4, new Set()).cellContents;

const actions: FaceActionHandlers = { confirm: () => {}, rejectMatch: () => {}, labelAs: () => {}, remove: () => {} };

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
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MantineProvider env="test">
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
          handleCellClick={() => {}}
          handleShowClick={() => {}}
          selectMode={false}
          selectedFaces={[]}
          setSelectedFaces={() => {}}
          activeTab="inferred"
          collapsedPersons={new Set()}
          onToggleCollapse={() => {}}
          faceActions={actions}
          pendingFaceIds={new Set([21])}
          showScrubber
        />
      </MantineProvider>
    )
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const labels = (selector: string) =>
  Array.from(container.querySelectorAll(selector)).map(element => element.getAttribute("aria-label"));

describe("issue 599 - the faces grid's per-face buttons", () => {
  it("gives every loaded face a button and a menu named after its group, and placeholders none", () => {
    expect(labels("button[aria-label^='Face in']")).toEqual([
      "Face in Anna",
      "Face in Unknown 001",
      `Face in ${UNKNOWN_PERSON_NAME}`,
    ]);
    expect(labels("button[aria-label^='Face actions']")).toHaveLength(3);
  });

  it("offers Confirm only on the named person's face", () => {
    expect(labels("button[aria-label^='Confirm as']")).toEqual(["Confirm as Anna"]);
  });

  it("marks the faces an action was sent for", () => {
    expect(container.querySelectorAll("[data-pending]")).toHaveLength(1);
    expect(container.querySelector("[data-pending] button[aria-label='Face in Unknown 001']")).not.toBeNull();
  });
});
