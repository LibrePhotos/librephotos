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
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { HeaderComponent } from "../components/facedashboard/HeaderComponent";
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
const PEOPLE = [person(1, "Alice", 9), person(2, "Bob", 5)];

async function renderHeader(cell: any, isCollapsed: boolean, onToggleCollapse: () => void) {
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
          setSelectedFaces={() => {}}
          isCollapsed={isCollapsed}
          onToggleCollapse={onToggleCollapse}
        />
      </MantineProvider>
    );
  });
  const toggle = container.querySelector<HTMLButtonElement>("button[aria-expanded]");
  return {
    toggle,
    text: container.textContent ?? "",
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("issue #405 - fold/unfold person groups on the faces page", () => {
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
});
