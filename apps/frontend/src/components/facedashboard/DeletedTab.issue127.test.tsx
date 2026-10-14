/**
 * https://github.com/LibrePhotos/librephotos/issues/127 ("Undo button")
 *
 * A face deleted by mistake could not be brought back. The faces dashboard now has a Deleted tab:
 * the deleted faces grouped by the person each one had, restored by selection (the toolbar's
 * Restore), a whole person at once (the header's Restore all) or one at a time (the face's menu).
 * The other actions do not apply to a deleted face, so the tab does not offer them.
 */
import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletePersonFace } from "../../api_client/faces/types";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import type { FaceActionHandlers } from "./faceActionRules";
import { canRestoreAll, hasPersonMenu } from "./faceActionRules";
import { FaceComponent } from "./FaceComponent";
import type { FacesTab } from "./facesTab";
import { HeaderButtons } from "./HeaderButtons";
import { HeaderComponent } from "./HeaderComponent";
import type { FaceCell, FaceSelection } from "./hooks/useVirtualizedGrid";

type RestoreMutate = (request: { faceIds: number[] }) => void;

const stubs = vi.hoisted(() => ({
  tab: "deleted" as string,
  restore: vi.fn<RestoreMutate>(),
}));

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
  useRenamePersonAlbumMutation: () => ({ mutate: () => {} }),
  useDeletePersonAlbumMutation: () => ({ mutate: () => {} }),
  useFetchPeopleAlbumsQuery: () => ({ data: [] }),
}));
vi.mock("../../api_client/faces/hooks", () => ({
  useSetFacesPersonLabelMutation: () => ({ mutate: () => {} }),
  useRestoreFacesMutation: () => ({ mutate: stubs.restore }),
}));
vi.mock("../../api_client/faces", () => ({
  useTrainFacesMutation: () => ({ mutate: () => {}, isPending: false }),
}));

const FACE: FaceCell = {
  id: 5,
  image: "/media/faces/5.jpg",
  face_url: "/media/faces/5.jpg",
  photo: "abc",
  person: 1,
  person_name: "Anna",
  person_label_probability: 1,
};

function group(id: number, name: string, kind: string, faces: FaceCell[] = [FACE]): CompletePersonFace {
  return { id, name, kind, face_count: faces.length, faces };
}

const ANNA = group(1, "Anna", "USER", [FACE, { ...FACE, id: 6 }, { ...FACE, id: 99, isTemp: true }]);
const OTHER = group(0, UNKNOWN_PERSON_NAME, UNKNOWN_PERSON_NAME);

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
  stubs.tab = "deleted";
  stubs.restore.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(node: React.ReactNode) {
  // env="test": no transitions or portals, so menus render in place
  await act(async () => root.render(<MantineProvider env="test">{node}</MantineProvider>));
}

const buttonLabelled = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const buttonNamed = (text: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === text);

async function click(element: HTMLElement | null | undefined) {
  await act(async () => defined(element, "the element to click").click());
}

describe("the Deleted tab's rules", () => {
  it.each<[FacesTab, boolean]>([
    ["deleted", true],
    ["inferred", false],
    ["labeled", false],
  ])("offers Restore all for a named person on the %s tab: %s", (tab, offered) => {
    expect(canRestoreAll(tab, ANNA)).toBe(offered);
  });

  it("offers no Restore all for the deleted faces of no one", () => {
    expect(canRestoreAll("deleted", OTHER)).toBe(false);
  });

  it("keeps the person menu (rename, delete the person) off the Deleted tab", () => {
    expect(hasPersonMenu("labeled", ANNA)).toBe(true);
    expect(hasPersonMenu("deleted", ANNA)).toBe(false);
  });
});

describe("a person's header on the Deleted tab", () => {
  async function renderHeader(
    cell: CompletePersonFace,
    selectedFaces: FaceSelection[] = [],
    setSelectedFaces: (faces: FaceSelection[]) => void = () => {}
  ) {
    await render(
      <HeaderComponent
        cell={cell}
        style={{}}
        selectedFaces={selectedFaces}
        setSelectedFaces={setSelectedFaces}
        onToggleCollapse={() => {}}
        coverUrl={undefined}
        takeFocus={false}
        onFocused={() => {}}
      />
    );
  }

  it("restores every loaded face of the person, and offers neither Confirm all nor the menu", async () => {
    const setSelectedFaces = vi.fn<(faces: FaceSelection[]) => void>();
    const elsewhere = { face_id: 40, face_url: null };
    await renderHeader(ANNA, [{ face_id: 5, face_url: null }, elsewhere], setSelectedFaces);

    expect(buttonLabelled(i18n.t("facesdashboard.explanationvalidate"))).toBeNull();
    expect(container.querySelector("button[aria-haspopup=menu]")).toBeNull();
    await click(buttonLabelled("Restore every face of Anna"));

    expect(stubs.restore).toHaveBeenCalledWith({ faceIds: [5, 6] });
    // The restored faces leave the tab, and the selection
    expect(setSelectedFaces).toHaveBeenLastCalledWith([elsewhere]);
  });

  it("has no Restore all for the faces of no one", async () => {
    await renderHeader(OTHER);

    expect(container.querySelector('button[aria-label^="Restore every face"]')).toBeNull();
  });
});

describe("a deleted face's menu", () => {
  it("offers Restore face and Show photo, nothing else", async () => {
    const actions: { [K in keyof FaceActionHandlers]: ReturnType<typeof vi.fn<FaceActionHandlers[K]>> } = {
      confirm: vi.fn<FaceActionHandlers["confirm"]>(),
      rejectMatch: vi.fn<FaceActionHandlers["rejectMatch"]>(),
      labelAs: vi.fn<FaceActionHandlers["labelAs"]>(),
      remove: vi.fn<FaceActionHandlers["remove"]>(),
      restore: vi.fn<FaceActionHandlers["restore"]>(),
    };
    await render(
      <FaceComponent
        cell={FACE}
        group={ANNA}
        tab="deleted"
        actions={actions}
        pending={false}
        isScrollingFast={false}
        selectMode={false}
        entrySquareSize={131}
        isSelected={false}
        handleClick={() => {}}
        handleShowClick={() => {}}
      />
    );
    await click(buttonLabelled("Face actions (Anna)"));

    const items = Array.from(container.querySelectorAll<HTMLButtonElement>("[role=menuitem]"));
    expect(items.map(item => item.textContent)).toEqual(["Restore face", "Show photo"]);
    await click(items[0]);
    expect(actions.restore).toHaveBeenCalledWith(FACE);
  });
});

describe("the toolbar on the Deleted tab", () => {
  async function renderToolbar(selectedFaces: FaceSelection[], restoreFaces: () => void) {
    await render(
      <HeaderButtons
        selectMode={selectedFaces.length > 0}
        selectedFaces={selectedFaces}
        changeSelectMode={() => {}}
        addFaces={() => {}}
        deleteFaces={() => {}}
        notThisPerson={() => {}}
        restoreFaces={restoreFaces}
        allCollapsed={false}
        toggleAllCollapsed={() => {}}
        canCollapse
      />
    );
  }

  it("restores the selection with a labelled button instead of add, not this person and delete", async () => {
    const restoreFaces = vi.fn<() => void>();
    await renderToolbar(
      [
        { face_id: 5, face_url: null },
        { face_id: 6, face_url: null },
      ],
      restoreFaces
    );

    expect(buttonLabelled(i18n.t("facesdashboard.explanationdeleting"))).toBeNull();
    expect(buttonLabelled(i18n.t("facesdashboard.explanationadding"))).toBeNull();
    await click(buttonNamed("Restore 2 faces"));

    expect(restoreFaces).toHaveBeenCalledTimes(1);
  });

  it("says why Restore does nothing before a face is selected", async () => {
    const restoreFaces = vi.fn<() => void>();
    await renderToolbar([], restoreFaces);

    const restore = defined(buttonNamed("Restore"), "the Restore button");
    await click(restore);

    expect(restore.getAttribute("aria-disabled")).toBe("true");
    expect(restoreFaces).not.toHaveBeenCalled();
  });

  it("keeps add, not this person and delete on the other tabs", async () => {
    stubs.tab = "labeled";
    await renderToolbar([{ face_id: 5, face_url: null }], () => {});

    expect(buttonLabelled(i18n.t("facesdashboard.explanationdeleting"))).not.toBeNull();
    expect(buttonNamed("Restore 1 face")).toBeUndefined();
  });
});
