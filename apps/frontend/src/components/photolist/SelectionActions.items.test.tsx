/**
 * Every item of the selection menus sends what it says: the selected hashes for a plain selection,
 * the server-side query (minus the excluded tiles) after "Select all".
 */
import { PigPhoto } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason, focusAndReadTooltip } from "../common/disabledReason.test-utils";
import { SelectionActions } from "./SelectionActions";

type Props = React.ComponentProps<typeof SelectionActions>;
type Call = (...args: unknown[]) => unknown;

const stubs = vi.hoisted(() => ({
  favorite: vi.fn<Call>(),
  hidden: vi.fn<Call>(),
  archived: vi.fn<Call>(),
  public: vi.fn<Call>(),
  deleted: vi.fn<Call>(),
  category: vi.fn<Call>(),
  download: vi.fn<Call>(),
  createStack: vi.fn<Call>(),
  mergeStacks: vi.fn<Call>(),
  removeFromStack: vi.fn<Call>(async () => undefined),
}));
// The page the menu is on, and the signed-in user (undefined: not loaded yet).
const page = vi.hoisted(() => ({
  pathname: "/",
  user: undefined as { favorite_min_rating: number; rating_mode: string } | undefined,
}));
// The Files items have their own tests (FileActionItems.test.tsx).
vi.mock("./FileActionItems", () => ({ FileActionItems: () => null, SelectionFileItems: () => null }));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: page.pathname }) }));
vi.mock("../../api_client/urls", () => ({ serverAddress: "", shareAddress: "" }));
vi.mock("../../util/util", async importOriginal => ({
  ...(await importOriginal<typeof import("../../util/util")>()),
  copyToClipboard: () => {},
}));
vi.mock("../../api_client/albums/hooks", () => ({ useRemovePhotoFromUserAlbumMutation: () => ({ mutate: () => {} }) }));
vi.mock("../../api_client/jobs", () => ({ useDownloadPhotosMutation: () => ({ mutate: stubs.download }) }));
vi.mock("../../api_client/photos/hooks", () => ({
  useMarkPhotosDeletedMutation: () => ({ mutate: stubs.deleted }),
  useSetFavoritePhotosMutation: () => ({ mutate: stubs.favorite }),
  useSetPhotosRatingMutation: () => ({ mutate: () => {} }),
  useSetPhotosHiddenMutation: () => ({ mutate: stubs.hidden }),
  useSetPhotosArchivedMutation: () => ({ mutate: stubs.archived }),
  useSetPhotosPublicMutation: () => ({ mutate: stubs.public }),
  useSetPhotosCategoryMutation: () => ({ mutate: stubs.category }),
}));
vi.mock("../../api_client/stacks", () => ({
  useCreateManualStackMutation: () => ({ mutate: stubs.createStack }),
  useMergeStacksMutation: () => ({ mutate: stubs.mergeStacks }),
  useRemoveFromStackMutation: () => ({ mutateAsync: stubs.removeFromStack }),
}));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ userId: 1 }) }));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: page.user }),
}));
// The real dialog is tested on its own (BulkLocationModal.test.tsx): here it shows what it got.
vi.mock("../map/BulkLocationModal", () => ({
  BulkLocationModal: ({ selection, onDone }: { selection: object; onDone: () => void }) => (
    <button type="button" data-selection={JSON.stringify(selection)} onClick={onDone}>
      location dialog
    </button>
  ),
}));
// The real dialog is tested on its own: here it only hands back the confirmation.
vi.mock("../modals/ModalDownloadOptions", () => ({
  ModalDownloadOptions: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: (o: object) => void }) =>
    isOpen ? (
      <button type="button" onClick={() => onConfirm({ includeStackedPhotos: true })}>
        confirm download
      </button>
    ) : null,
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
});

const stack = { id: "11111111-1111-4111-8111-111111111111", type: "manual", photo_count: 2, is_primary: false };

function photo(n: number, stacked = false, state: { rating?: number; archived?: boolean } = {}) {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return PigPhoto.parse({ id, image_hash: `hash${n}`, aspectRatio: 1, stacks: stacked ? [stack] : [], ...state });
}

const callbacks = {
  updateSelectionState: vi.fn<Props["updateSelectionState"]>(),
  onSharePhotos: vi.fn<Props["onSharePhotos"]>(),
  onAddToAlbum: vi.fn<Props["onAddToAlbum"]>(),
  onAddTags: vi.fn<Props["onAddTags"]>(),
};

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  page.pathname = "/";
  page.user = undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

async function render(props: Partial<Props>) {
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <SelectionActions
          selectedItems={[photo(1, true), photo(2, true)]}
          setAlbumCover={() => {}}
          onShareAlbum={() => {}}
          title="Photos"
          {...callbacks}
          {...props}
        />
      </MantineProvider>
    )
  );
}

// The "+" and "⋮" menu buttons, by name: the bar's direct actions come before them.
const menuButton = (menu: 0 | 1) =>
  container.querySelector<HTMLButtonElement>(
    `button[aria-label="${i18n.t(menu === 0 ? "selectionactions.addto" : "selectionactions.photoactions")}"]`
  );

// The label without the shortcut hint ("T") some items carry on the right, or the name of an item
// with a note under its label (Hide, Archive)
const itemName = (item: HTMLElement) =>
  item.getAttribute("aria-label") ?? item.querySelector(".mantine-Menu-itemLabel")?.textContent?.trim();

const menuItems = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));

/** The open menus' item named `label`, opening the submenus (Edit info, Mark as) to find it. */
async function findItem(label: string): Promise<HTMLButtonElement | undefined> {
  const found = menuItems().find(item => itemName(item) === label);
  if (found) return found;
  for (const submenu of menuItems().filter(item => item.hasAttribute("data-sub-menu-item"))) {
    await act(async () => submenu.click());
    const inside = menuItems().find(item => itemName(item) === label);
    if (inside) return inside;
  }
  return undefined;
}

/** The names of the open menu's items, its submenus closed. */
const itemNames = () => menuItems().map(item => itemName(item));

/** Opens the first ("+") or second ("⋮") menu and clicks the item with `label`. */
async function pick(menu: 0 | 1, label: string) {
  await act(async () => defined(menuButton(menu)).click());
  const item = await findItem(label);
  await act(async () => defined(item, label).click());
}

// [item, its mutation, what it sends, the page it is offered on]. Unhide is offered on the Hidden
// page, where every photo is hidden; Hide everywhere else.
const items: [string, Call, object, string?][] = [
  ["Favorite", stubs.favorite, { favorite: true }],
  ["Unfavorite", stubs.favorite, { favorite: false }],
  ["Hide", stubs.hidden, { hidden: true }],
  ["Unhide", stubs.hidden, { hidden: false }, "/hidden"],
  ["Archive", stubs.archived, { archived: true }],
  ["Unarchive", stubs.archived, { archived: false }],
  ["Make public", stubs.public, { val_public: true }],
  ["Make private", stubs.public, { val_public: false }],
  ["Move to trash", stubs.deleted, { deleted: true }],
  ["Screenshot", stubs.category, { category: "screenshot" }],
];

describe("the photo actions", () => {
  it.each(items)("%s sends the selected hashes", async (label, mutate, change, pathname = "/") => {
    page.pathname = pathname;
    await render({});

    await pick(1, label);

    expect(mutate).toHaveBeenCalledWith({ image_hashes: ["hash1", "hash2"], ...change });
    expect(callbacks.updateSelectionState).toHaveBeenCalledWith(expect.objectContaining({ selectMode: false }));
  });

  it.each(items)("%s sends the query after Select all", async (label, mutate, change, pathname = "/") => {
    page.pathname = pathname;
    await render({ selectAllMode: true, selectAllQuery: { person: 5 }, selectedItems: [photo(3)] });

    await pick(1, label);

    expect(mutate).toHaveBeenCalledWith({
      select_all: true,
      query: { person: 5 },
      excluded_hashes: ["hash3"],
      ...change,
    });
  });

  it.each([false, true])("downloads, select all = %s", async selectAllMode => {
    await render({ selectAllMode, selectAllQuery: { person: 5 }, totalCount: 4 });

    await pick(1, "Download");
    await act(async () => button("confirm download").click());

    expect(stubs.download).toHaveBeenCalledWith(
      selectAllMode
        ? expect.objectContaining({ select_all: true, excluded_hashes: ["hash1", "hash2"], includeStackedPhotos: true })
        : expect.objectContaining({ image_hashes: ["hash1", "hash2"], userId: 1, includeStackedPhotos: true })
    );
  });

  it.each([
    [false, { image_hashes: ["hash1", "hash2"] }],
    [true, { select_all: true, query: { person: 5 }, excluded_hashes: ["hash1", "hash2"] }],
  ])("Set location… opens the dialog for the selection, select all = %s", async (selectAllMode, selection) => {
    await render({ selectAllMode, selectAllQuery: { person: 5 } });
    expect(document.body.textContent).not.toContain("location dialog");

    await pick(1, "Set location…");

    expect(button("location dialog").dataset.selection).toBe(JSON.stringify(selection));
    await act(async () => button("location dialog").click());
    expect(callbacks.updateSelectionState).toHaveBeenCalledWith(expect.objectContaining({ selectMode: false }));
  });

  it("opens the sharing panel", async () => {
    await render({});

    await pick(1, "Sharing");

    expect(callbacks.onSharePhotos).toHaveBeenCalledTimes(1);
  });
});

// Review s0 #6: the menu listed both of each pair whatever the selection held.
describe("one of each pair, when the selection says which", () => {
  const favoriteUser = { favorite_min_rating: 4, rating_mode: "favorite" };

  async function openWith(props: Partial<Props>) {
    await render(props);
    await act(async () => defined(menuButton(1)).click());
    return itemNames();
  }

  it("offers Favorite while a photo is not one", async () => {
    page.user = favoriteUser;
    const names = await openWith({ selectedItems: [photo(1, false, { rating: 5 }), photo(2, false, { rating: 0 })] });
    expect(names).toContain("Favorite");
    expect(names).not.toContain("Unfavorite");
  });

  it("offers Unfavorite alone when every photo is a favorite", async () => {
    page.user = favoriteUser;
    const names = await openWith({ selectedItems: [photo(1, false, { rating: 5 }), photo(2, false, { rating: 4 })] });
    expect(names).toContain("Unfavorite");
    expect(names).not.toContain("Favorite");
  });

  it("offers both after Select all, where the photos are not known", async () => {
    page.user = favoriteUser;
    const names = await openWith({ selectAllMode: true, selectAllQuery: { person: 5 }, selectedItems: [] });
    expect(names).toEqual(expect.arrayContaining(["Favorite", "Unfavorite", "Archive", "Unarchive"]));
  });

  it.each([
    [[false, true], "Archive", "Unarchive"],
    [[true, true], "Unarchive", "Archive"],
  ])("archived %j offers %s, not %s", async (archived, offered, notOffered) => {
    const names = await openWith({ selectedItems: archived.map((state, n) => photo(n, false, { archived: state })) });
    expect(names).toContain(offered);
    expect(names).not.toContain(notOffered);
  });

  it.each([
    ["/", "Hide", "Unhide"],
    ["/hidden", "Unhide", "Hide"],
  ])("on %s offers %s, not %s", async (pathname, offered, notOffered) => {
    page.pathname = pathname;
    const names = await openWith({});
    expect(names).toContain(offered);
    expect(names).not.toContain(notOffered);
  });

  it("ends with Move to trash", async () => {
    expect((await openWith({})).at(-1)).toBe("Move to trash");
  });
});

describe("the stack actions", () => {
  it("stacks the selection", async () => {
    await render({});

    await pick(1, "Create stack");

    expect(stubs.createStack).toHaveBeenCalledWith({ photo_hashes: ["hash1", "hash2"] }, expect.anything());
  });

  it("merges the stacks of the selection", async () => {
    await render({});

    await pick(1, "Merge stacks");

    expect(stubs.mergeStacks).toHaveBeenCalledWith({ photo_hashes: ["hash1", "hash2"] }, expect.anything());
  });

  it("takes the selection out of its stacks, one request per stack", async () => {
    await render({});

    await pick(1, "Break apart stacks");

    expect(stubs.removeFromStack).toHaveBeenCalledWith({
      stackId: stack.id,
      data: { photo_hashes: ["hash1", "hash2"] },
    });
  });
});

describe("the add-to menu", () => {
  it("opens the album and the tag dialogs", async () => {
    await render({});

    await pick(0, "Album");
    await pick(0, "Tags");

    expect(callbacks.onAddToAlbum).toHaveBeenCalledTimes(1);
    expect(callbacks.onAddTags).toHaveBeenCalledTimes(1);
  });

  // #2621: the + button was a plain `disabled`: greyed out with no reason, and out of the Tab order.
  it("asks for a selection first, and stays shut", async () => {
    await render({ selectedItems: [] });

    const add = defined(
      container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("selectionactions.addto")}"]`),
      "the + button"
    );
    expectDisabledWithReason(add, SELECT_FIRST);
    expect(await focusAndReadTooltip(add)).toContain(SELECT_FIRST);
    await act(async () => add.click());

    expect(add.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
  });
});

/** Opens the photo actions ("⋮") menu and returns the item with `label`. */
async function photoAction(label: string): Promise<HTMLButtonElement> {
  await act(async () => defined(menuButton(1)).click());
  return defined(await findItem(label), label);
}

/** Off, says why, and still in the menu's arrow-key order (Mantine skips `data-disabled` items, #2592). */
function expectReachableWithReason(item: HTMLElement, reason: string) {
  expectDisabledWithReason(item, reason);
  expect(item.hasAttribute("data-disabled")).toBe(false);
}

const SELECT_FIRST = "Select at least one photo first";
const NOT_WITH_SELECT_ALL = "Not available with Select all: select the photos one by one";
const stackActions = ["Create stack", "Merge stacks", "Break apart stacks"];

// #2608: these items were plain `disabled`: greyed out with no reason, and skipped by the arrow keys.
describe("a disabled item says why", () => {
  it.each([
    // Without a selection the submenus do not open: Edit info and Mark as say why instead
    ...items.filter(([label]) => label !== "Unhide" && label !== "Screenshot").map(([label]) => label),
    "Edit info",
    "Mark as",
    "Download",
    "Sharing",
    ...stackActions,
  ])("%s asks for a selection first, and does nothing", async label => {
    await render({ selectedItems: [] });

    const item = await photoAction(label);
    expectReachableWithReason(item, SELECT_FIRST);
    await act(async () => item.click());

    for (const stub of Object.values(stubs)) expect(stub).not.toHaveBeenCalled();
    expect(callbacks.onSharePhotos).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("confirm download");
  });

  it.each(stackActions)("%s is not offered after Select all", async label => {
    await render({ selectAllMode: true, selectAllQuery: { person: 5 } });

    expectReachableWithReason(await photoAction(label), NOT_WITH_SELECT_ALL);
  });

  it("Create Stack needs two photos", async () => {
    await render({ selectedItems: [photo(1)] });

    const item = await photoAction("Create stack");
    expectReachableWithReason(item, "Select at least two photos to stack them");
    expect(await focusAndReadTooltip(item)).toContain("Select at least two photos to stack them");
  });

  it.each(["Merge stacks", "Break apart stacks"])("%s needs a photo in a manual stack", async label => {
    await render({ selectedItems: [photo(1), photo(2)] });

    expectReachableWithReason(await photoAction(label), "None of the selected photos is in a manual stack");
  });
});

function button(text: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(el => el.textContent?.trim() === text);
  return defined(found, text);
}
