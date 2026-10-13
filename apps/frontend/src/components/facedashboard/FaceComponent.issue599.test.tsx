/**
 * https://github.com/LibrePhotos/librephotos/issues/599
 *
 *   "confirm", "wrong match" and "delete face" buttons per face in the "inferred" view.
 *
 * Each face gets a one-click Confirm (only where its group is a named person) and a ⋮ menu with
 * the wrong match, Label as…, Show photo and Delete. The face itself is a button, so the keyboard
 * reaches every face (#2228).
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletePersonFace } from "../../api_client/faces/types";
import i18n from "../../i18n";
import type { FaceActionHandlers } from "./faceActionRules";
import { FaceComponent } from "./FaceComponent";
import type { FacesTab } from "./facesTab";
import type { FaceCell } from "./hooks/useVirtualizedGrid";

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => ({ tab: "inferred" }) }),
}));

type Props = React.ComponentProps<typeof FaceComponent>;

const FACE: FaceCell = {
  id: 5,
  image: "/media/faces/5.jpg",
  face_url: "/media/faces/5.jpg",
  photo: "abc",
  person: null,
  person_name: "Unknown - Other",
  person_label_probability: 0.87,
};

function group(name: string, kind: string): CompletePersonFace {
  return { id: 1, name, kind, face_count: 1, faces: [FACE] };
}

const ANNA = group("Anna", "USER");

let root: Root;
let container: HTMLDivElement;
let actions: { [K in keyof FaceActionHandlers]: ReturnType<typeof vi.fn<FaceActionHandlers[K]>> };
let handleClick: ReturnType<typeof vi.fn<Props["handleClick"]>>;
let handleShowClick: ReturnType<typeof vi.fn<Props["handleShowClick"]>>;

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
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  actions = {
    confirm: vi.fn<FaceActionHandlers["confirm"]>(),
    rejectMatch: vi.fn<FaceActionHandlers["rejectMatch"]>(),
    labelAs: vi.fn<FaceActionHandlers["labelAs"]>(),
    remove: vi.fn<FaceActionHandlers["remove"]>(),
  };
  handleClick = vi.fn<Props["handleClick"]>();
  handleShowClick = vi.fn<Props["handleShowClick"]>();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

type Options = { of?: CompletePersonFace; tab?: FacesTab; selectMode?: boolean; pending?: boolean };

async function renderFace({ of = ANNA, tab = "inferred", selectMode = false, pending = false }: Options = {}) {
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the menu renders in place
      <MantineProvider env="test">
        <FaceComponent
          cell={FACE}
          group={of}
          tab={tab}
          actions={actions}
          pending={pending}
          isScrollingFast={false}
          selectMode={selectMode}
          entrySquareSize={131}
          isSelected={false}
          handleClick={handleClick}
          handleShowClick={handleShowClick}
        />
      </MantineProvider>
    );
  });
}

const buttonLabelled = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

function menuItem(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("[role=menuitem]")).find(
    item => item.textContent === text
  );
}

const menuItems = () => Array.from(container.querySelectorAll("[role=menuitem]")).map(item => item.textContent);

async function click(element: HTMLElement | null | undefined) {
  if (!element) throw new Error("nothing to click");
  await act(async () => element.click());
}

async function openMenu(groupName = "Anna") {
  await click(buttonLabelled(`Face actions (${groupName})`));
}

describe("issue 599 - per-face actions", () => {
  it("confirms an inferred face as its group's person in one click", async () => {
    await renderFace();

    await click(buttonLabelled("Confirm as Anna"));

    expect(actions.confirm).toHaveBeenCalledWith(FACE, "Anna");
  });

  it("offers the wrong match, Label as…, Show photo and Delete in the face's menu", async () => {
    await renderFace();
    await openMenu();

    expect(menuItems()).toEqual(["Not Anna", "Label as…", "Show photo", "Delete face"]);

    await click(menuItem("Not Anna"));
    expect(actions.rejectMatch).toHaveBeenCalledWith(FACE);
  });

  it.each([
    ["Label as…", "labelAs"],
    ["Delete face", "remove"],
  ] as const)("%s acts on this one face", async (item, action) => {
    await renderFace();
    await openMenu();

    await click(menuItem(item));

    expect(actions[action]).toHaveBeenCalledWith(FACE);
  });

  it("opens the photo from the menu", async () => {
    await renderFace();
    await openMenu();

    await click(menuItem("Show photo"));

    expect(handleShowClick).toHaveBeenCalledWith(expect.anything(), FACE);
  });

  it("has no Confirm for a cluster, and moves its face to Unknown - Other instead of naming anyone", async () => {
    await renderFace({ of: group("Unknown 001", "CLUSTER") });

    expect(buttonLabelled("Confirm as Unknown 001")).toBeNull();
    await openMenu("Unknown 001");
    expect(menuItems()).toEqual(["Move to Unknown - Other", "Label as…", "Show photo", "Delete face"]);
  });

  it("has neither Confirm nor a wrong match for a face already in Unknown - Other", async () => {
    await renderFace({ of: group("Unknown - Other", "Unknown - Other") });

    expect(container.querySelector("button[aria-label^='Confirm']")).toBeNull();
    await openMenu("Unknown - Other");
    expect(menuItems()).toEqual(["Label as…", "Show photo", "Delete face"]);
  });

  it("has no Confirm on the Labeled tab, but can still undo a label", async () => {
    await renderFace({ tab: "labeled" });

    expect(buttonLabelled("Confirm as Anna")).toBeNull();
    await openMenu();
    expect(menuItems()).toContain("Not Anna");
  });

  it("leaves only Show photo while faces are selected: the toolbar acts on the selection", async () => {
    await renderFace({ selectMode: true });

    expect(buttonLabelled("Confirm as Anna")).toBeNull();
    await openMenu();
    expect(menuItems()).toEqual(["Show photo"]);
  });

  it("disables the buttons of a face an action was already sent for, without dropping focus", async () => {
    await renderFace({ pending: true });
    const confirm = buttonLabelled("Confirm as Anna");

    // aria-disabled, not disabled: a disabled button would lose keyboard focus to the page
    expect(confirm?.getAttribute("aria-disabled")).toBe("true");
    expect(confirm?.disabled).toBe(false);
    await click(confirm);
    await openMenu();

    expect(actions.confirm).not.toHaveBeenCalled();
    expect(menuItems()).toEqual([]);
  });

  it("makes the face itself a button that selects it", async () => {
    await renderFace();
    const face = buttonLabelled("Face in Anna");

    await click(face);

    expect(face?.getAttribute("aria-pressed")).toBe("false");
    expect(handleClick).toHaveBeenCalledWith(expect.anything(), FACE);
  });

  it("opens the menu on a right click or a long press", async () => {
    await renderFace();
    const face = buttonLabelled("Face in Anna");
    if (!face) throw new Error("no face button");
    const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

    await act(async () => face.dispatchEvent(contextMenu));

    expect(contextMenu.defaultPrevented).toBe(true);
    expect(menuItems()).toContain("Delete face");
  });
});
