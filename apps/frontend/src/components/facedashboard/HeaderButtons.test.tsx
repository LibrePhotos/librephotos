/**
 * The faces toolbar: its select button counts the selection in one translated sentence (#2201),
 * and the controls follow the tab (#127, #2237).
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { HeaderButtons } from "./HeaderButtons";
import type { FaceSelection } from "./hooks/useVirtualizedGrid";

const stubs = vi.hoisted(() => ({ tab: "labeled" as string, train: vi.fn<() => void>() }));

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({
    useSearch: () => ({
      tab: stubs.tab,
      method: "clustering",
      orderBy: "confidence",
      minConfidence: 0.7,
      personOrder: "name",
    }),
  }),
  useNavigate: () => () => {},
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useDeletePersonGroupMutation: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("../../api_client/faces", () => ({
  useTrainFacesMutation: () => ({ mutate: stubs.train, isPending: false }),
}));

let root: Root;
let container: HTMLDivElement;

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
  // The toolbar's Selects measure themselves; jsdom has no ResizeObserver
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.tab = "labeled";
  stubs.train.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const faces = (count: number): FaceSelection[] =>
  Array.from({ length: count }, (_, i) => ({ face_id: i + 1, face_url: null }));

async function renderToolbar(selectedFaces: FaceSelection[], deleteFaces = () => {}) {
  await act(async () =>
    root.render(
      // env="test": no transitions or portals, so the dialog renders in place
      <MantineProvider env="test">
        <HeaderButtons
          selectMode={selectedFaces.length > 0}
          selectedFaces={selectedFaces}
          changeSelectMode={() => {}}
          addFaces={() => {}}
          deleteFaces={deleteFaces}
          notThisPerson={() => {}}
          restoreFaces={() => {}}
          allCollapsed
          toggleAllCollapsed={() => {}}
          canCollapse
          personGroups={[]}
          groupId={undefined}
        />
      </MantineProvider>
    )
  );
}

const buttonLabelled = (label: string) =>
  defined(document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`));
const buttonWithText = (text: string) =>
  defined([...document.body.querySelectorAll("button")].find(button => button.textContent === text));

describe("the faces toolbar", () => {
  it("counts the selection in one sentence", async () => {
    await renderToolbar(faces(1));
    expect(buttonWithText("1 selected")).toBeDefined();

    await renderToolbar(faces(1234));
    expect(buttonWithText("1,234 selected")).toBeDefined();
  });

  it("offers the analysis method and the confidence only on the Inferred tab", async () => {
    await renderToolbar([]);
    expect(container.querySelector("input[inputmode]")).toBeNull();

    stubs.tab = "inferred";
    await renderToolbar([]);
    expect(container.querySelector("input[inputmode]")).not.toBeNull();
  });

  it("asks before deleting the selected faces", async () => {
    const deleteFaces = vi.fn<() => void>();
    await renderToolbar(faces(2), deleteFaces);

    await act(async () => buttonLabelled(i18n.t("facesdashboard.explanationdeleting")).click());
    await act(async () => buttonWithText(i18n.t("confirmdialog.deletefaces.confirm", { count: 2 })).click());

    expect(deleteFaces).toHaveBeenCalledOnce();
  });

  it("trains the faces", async () => {
    await renderToolbar([]);
    await act(async () => buttonLabelled(i18n.t("facesdashboard.explanationtraining")).click());
    expect(stubs.train).toHaveBeenCalledOnce();
  });
});
