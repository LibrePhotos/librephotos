/**
 * The group header of "Unknown - Other". The backend appends that group to the face lists with
 * its name as its kind, not "UNKNOWN", so a header that hid its buttons only for the kinds
 * "CLUSTER" and "UNKNOWN" offered them on the unknown group: "Confirm all" labelled its faces as
 * the unknown person (which also drops their cluster and classifier suggestions), and the ⋮ menu
 * renamed or deleted a person with id 0 that does not exist.
 */
import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CompletePersonFace } from "../../api_client/faces/types";
import i18n from "../../i18n";
import type { FacesTab } from "./facesTab";
import { HeaderComponent } from "./HeaderComponent";

type HeaderProps = React.ComponentProps<typeof HeaderComponent>;

const stubs = vi.hoisted(() => ({ tab: "inferred" as string }));

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => ({ tab: stubs.tab }) }),
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useRenamePersonAlbumMutation: () => ({ mutate: vi.fn<(...args: unknown[]) => void>() }),
  useDeletePersonAlbumMutation: () => ({ mutate: vi.fn<(...args: unknown[]) => void>() }),
  useFetchPeopleAlbumsQuery: () => ({ data: [] }),
}));
vi.mock("../../api_client/faces/hooks", () => ({
  useSetFacesPersonLabelMutation: () => ({ mutate: vi.fn<(...args: unknown[]) => void>() }),
}));

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
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
}, 60000);

function group(id: number, name: string, kind: string): CompletePersonFace {
  return {
    id,
    name,
    kind,
    face_count: 1,
    faces: [{ id: id * 10 + 1, image: "/f.jpg", face_url: "/f.jpg", photo: "p1", isTemp: false }],
  };
}

// As GET /faces/incomplete/ appends it: id 0, its name as its kind
const OTHER = group(0, UNKNOWN_PERSON_NAME, UNKNOWN_PERSON_NAME);
const ANNA = group(1, "Anna", "USER");

let cleanup: () => Promise<void> = async () => {};

afterEach(async () => {
  await cleanup();
});

async function renderHeader(tab: FacesTab, cell: CompletePersonFace) {
  stubs.tab = tab;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <HeaderComponent
          cell={cell}
          style={{}}
          selectedFaces={[]}
          setSelectedFaces={vi.fn<HeaderProps["setSelectedFaces"]>()}
          isCollapsed={false}
          onToggleCollapse={vi.fn<() => void>()}
        />
      </MantineProvider>
    );
  });
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return {
    confirmAll: container.querySelector(`button[aria-label="${i18n.t("facesdashboard.explanationvalidate")}"]`),
    menu: container.querySelector("button[aria-haspopup=menu]"),
  };
}

describe("the Unknown - Other group header", () => {
  it.each<FacesTab>(["inferred", "unknown"])("offers no Confirm all on the %s tab", async tab => {
    expect((await renderHeader(tab, OTHER)).confirmAll).toBeNull();
  });

  it.each<FacesTab>(["inferred", "unknown"])("offers no rename or delete on the %s tab", async tab => {
    expect((await renderHeader(tab, OTHER)).menu).toBeNull();
  });
});

describe("a named person's header", () => {
  it("still offers Confirm all on the Inferred tab, and the ⋮ menu", async () => {
    const header = await renderHeader("inferred", ANNA);
    expect(header.confirmAll).not.toBeNull();
    expect(header.menu).not.toBeNull();
  });

  it.each<[string, CompletePersonFace]>([
    ["a cluster", group(2, "Unknown 001", "CLUSTER")],
    ["an unknown-kind person", group(3, "Unknown 002", "UNKNOWN")],
  ])("offers neither for %s", async (_what, cell) => {
    const header = await renderHeader("inferred", cell);
    expect(header.confirmAll).toBeNull();
    expect(header.menu).toBeNull();
  });
});
