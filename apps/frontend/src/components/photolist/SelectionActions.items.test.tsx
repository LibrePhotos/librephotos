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
import { SelectionActions } from "./SelectionActions";

type Props = React.ComponentProps<typeof SelectionActions>;
type Call = (...args: unknown[]) => unknown;

const stubs = vi.hoisted(() => ({
  favorite: vi.fn<Call>(),
  hidden: vi.fn<Call>(),
  public: vi.fn<Call>(),
  deleted: vi.fn<Call>(),
  category: vi.fn<Call>(),
  download: vi.fn<Call>(),
  createStack: vi.fn<Call>(),
  mergeStacks: vi.fn<Call>(),
  removeFromStack: vi.fn<Call>(async () => undefined),
}));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: "/" }) }));
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
  useSetPhotosHiddenMutation: () => ({ mutate: stubs.hidden }),
  useSetPhotosPublicMutation: () => ({ mutate: stubs.public }),
  useSetPhotosCategoryMutation: () => ({ mutate: stubs.category }),
}));
vi.mock("../../api_client/stacks", () => ({
  useCreateManualStackMutation: () => ({ mutate: stubs.createStack }),
  useMergeStacksMutation: () => ({ mutate: stubs.mergeStacks }),
  useRemoveFromStackMutation: () => ({ mutateAsync: stubs.removeFromStack }),
}));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ userId: 1 }) }));
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

function photo(n: number, stacked = false) {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return PigPhoto.parse({ id, image_hash: `hash${n}`, aspectRatio: 1, stacks: stacked ? [stack] : [] });
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

/** Opens the first ("+") or second ("⋮") menu and clicks the item with `label`. */
async function pick(menu: 0 | 1, label: string) {
  await act(async () => defined(container.querySelectorAll("button")[menu]).click());
  const item = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    // The label without the shortcut hint ("t") some items carry on the right
    button => button.querySelector(".mantine-Menu-itemLabel")?.textContent?.trim() === label
  );
  await act(async () => defined(item, label).click());
}

const items: [string, Call, object][] = [
  ["Favorite", stubs.favorite, { favorite: true }],
  ["Unfavorite", stubs.favorite, { favorite: false }],
  ["Hide", stubs.hidden, { hidden: true }],
  ["Unhide", stubs.hidden, { hidden: false }],
  ["Make Public", stubs.public, { val_public: true }],
  ["Make Private", stubs.public, { val_public: false }],
  ["Move to trash", stubs.deleted, { deleted: true }],
  ["Mark as screenshot", stubs.category, { category: "screenshot" }],
];

describe("the photo actions", () => {
  it.each(items)("%s sends the selected hashes", async (label, mutate, change) => {
    await render({});

    await pick(1, label);

    expect(mutate).toHaveBeenCalledWith({ image_hashes: ["hash1", "hash2"], ...change });
    expect(callbacks.updateSelectionState).toHaveBeenCalledWith(expect.objectContaining({ selectMode: false }));
  });

  it.each(items)("%s sends the query after Select all", async (label, mutate, change) => {
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

  it("opens the sharing panel", async () => {
    await render({});

    await pick(1, "Sharing");

    expect(callbacks.onSharePhotos).toHaveBeenCalledTimes(1);
  });
});

describe("the stack actions", () => {
  it("stacks the selection", async () => {
    await render({});

    await pick(1, "Create Stack");

    expect(stubs.createStack).toHaveBeenCalledWith({ photo_hashes: ["hash1", "hash2"] }, expect.anything());
  });

  it("merges the stacks of the selection", async () => {
    await render({});

    await pick(1, "Merge Stacks");

    expect(stubs.mergeStacks).toHaveBeenCalledWith({ photo_hashes: ["hash1", "hash2"] }, expect.anything());
  });

  it("takes the selection out of its stacks, one request per stack", async () => {
    await render({});

    await pick(1, "Break Apart Stacks");

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
});

function button(text: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(el => el.textContent?.trim() === text);
  return defined(found, text);
}
