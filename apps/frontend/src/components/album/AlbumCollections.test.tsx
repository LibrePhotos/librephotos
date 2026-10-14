/**
 * Album collections (#1009): the My Albums chip row, the per-album checklist (saved on every tick,
 * with a field that creates a collection and files the album in it) and the Manage dialog
 * (rename in place, delete after a confirmation).
 */
import type { AlbumCollection } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api_client/apiError";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { AlbumCollectionFilter } from "./AlbumCollectionFilter";
import { AlbumCollectionsModal } from "./AlbumCollectionsModal";
import type { CollectionFilter } from "./collectionFilter";
import { ManageAlbumCollectionsModal } from "./ManageAlbumCollectionsModal";

type SetParams = { albumId: number | string; collectionIds: number[] };
type RenameParams = { id: number; name: string; newName: string };
type DeleteParams = { id: number; name: string };

const stubs = vi.hoisted(() => ({
  collections: [] as AlbumCollection[],
  setCollections: vi.fn<(params: SetParams, options?: { onError?: () => void }) => void>(),
  create: vi.fn<(name: string) => Promise<AlbumCollection>>(),
  rename: vi.fn<(params: RenameParams) => Promise<AlbumCollection>>(),
  remove: vi.fn<(params: DeleteParams, options?: { onSettled?: () => void }) => void>(),
}));

vi.mock("../../api_client/albums/hooks", () => ({
  useFetchAlbumCollectionsQuery: () => ({
    data: stubs.collections,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: () => Promise.resolve(),
  }),
  useSetUserAlbumCollectionsMutation: () => ({ mutate: stubs.setCollections }),
  useCreateAlbumCollectionMutation: () => ({ mutateAsync: stubs.create, isPending: false }),
  useRenameAlbumCollectionMutation: () => ({ mutateAsync: stubs.rename, isPending: false }),
  useDeleteAlbumCollectionMutation: () => ({ mutate: stubs.remove, isPending: false }),
}));

const travel = { id: 3, name: "Travel" };
const family = { id: 5, name: "Family" };

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
  // The dialogs' ScrollArea measures its viewport; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

let root: Root | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  stubs.collections = [family, travel];
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => defined(root).render(<MantineProvider env="test">{node}</MantineProvider>));
}

function button(name: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(
    el => el.getAttribute("aria-label") === name || el.textContent?.trim() === name
  );
  return defined(found, `button ${name}`);
}

function checkbox(name: string): HTMLInputElement {
  const label = Array.from(document.body.querySelectorAll("label")).find(el => el.textContent?.trim() === name);
  const input = document.getElementById(defined(label, `checkbox ${name}`).htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no input for ${name}`);
  return input;
}

/** React tracks the previous value on the node itself, so plain assignment is swallowed. */
async function type(name: string, value: string) {
  const input = defined(document.body.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`), name);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

describe("AlbumCollectionsModal", () => {
  const renderChecklist = () =>
    render(
      <AlbumCollectionsModal opened onClose={() => {}} albumId="7" albumTitle="Porto" collectionIds={[travel.id]} />
    );

  it("ticks the album's collections and saves the whole list on a tick", async () => {
    await renderChecklist();
    expect(checkbox("Travel").checked).toBe(true);
    expect(checkbox("Family").checked).toBe(false);

    await click(checkbox("Family"));

    expect(stubs.setCollections).toHaveBeenCalledWith({ albumId: "7", collectionIds: [3, 5] }, expect.anything());
    expect(checkbox("Family").checked).toBe(true);
  });

  it("puts a box back when its save fails", async () => {
    await renderChecklist();
    await click(checkbox("Travel"));
    expect(checkbox("Travel").checked).toBe(false);

    await act(async () => defined(stubs.setCollections.mock.calls[0]?.[1]?.onError)());

    expect(checkbox("Travel").checked).toBe(true);
  });

  it("creates a collection and files the album in it", async () => {
    stubs.create.mockResolvedValue({ id: 9, name: "Beach" });
    await renderChecklist();

    await type("New collection", "  Beach ");
    await click(button("Add"));

    expect(stubs.create).toHaveBeenCalledWith("Beach");
    expect(stubs.setCollections).toHaveBeenCalledWith({ albumId: "7", collectionIds: [3, 9] }, expect.anything());
  });

  it("refuses a name in use in another letter case, before asking the server", async () => {
    await renderChecklist();

    await type("New collection", "travel");
    await click(button("Add"));

    expect(stubs.create).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Collection travel already exists.");
  });

  it("shows the server's reason when creating fails", async () => {
    stubs.create.mockRejectedValue(new ApiError("Bad Request", 400, "Collection 'Beach' already exists."));
    await renderChecklist();

    await type("New collection", "Beach");
    await click(button("Add"));

    expect(document.body.textContent).toContain("Collection 'Beach' already exists.");
    expect(stubs.setCollections).not.toHaveBeenCalled();
  });

  it("says so while there are no collections", async () => {
    stubs.collections = [];
    await renderChecklist();

    expect(document.body.textContent).toContain(i18n.t("albumcollections.none"));
  });
});

describe("ManageAlbumCollectionsModal", () => {
  const counts = new Map([[travel.id, 2]]);
  const renderManage = () => render(<ManageAlbumCollectionsModal opened onClose={() => {}} counts={counts} />);

  it("lists each collection with its album count", async () => {
    await renderManage();

    expect(document.body.textContent).toContain("Travel2 albums");
    expect(document.body.textContent).toContain("Family0 albums");
  });

  it("renames in place, refusing another collection's name", async () => {
    stubs.rename.mockResolvedValue({ id: 3, name: "Trips" });
    await renderManage();
    await click(button("Rename Travel"));

    await type("Rename Travel", "family");
    await click(button("Rename"));
    expect(stubs.rename).not.toHaveBeenCalled();

    await type("Rename Travel", "Trips");
    await click(button("Rename"));
    expect(stubs.rename).toHaveBeenCalledWith({ id: 3, name: "Travel", newName: "Trips" });
    expect(document.body.querySelector('input[aria-label="Rename Travel"]')).toBeNull();
  });

  it("backs out of a rename", async () => {
    await renderManage();
    await click(button("Rename Travel"));
    await click(button("Cancel"));

    expect(document.body.querySelector('input[aria-label="Rename Travel"]')).toBeNull();
  });

  it("deletes a collection after the confirmation", async () => {
    stubs.remove.mockImplementation((_, options) => options?.onSettled?.());
    await renderManage();
    await click(button("Delete Travel"));

    expect(document.body.textContent).toContain("Delete the collection Travel?");
    await click(button("Delete collection"));

    expect(stubs.remove).toHaveBeenCalledWith({ id: 3, name: "Travel" }, expect.anything());
  });

  it("creates a collection", async () => {
    stubs.create.mockResolvedValue({ id: 9, name: "Beach" });
    await renderManage();

    await type("New collection", "Beach");
    await click(button("Add"));

    expect(stubs.create).toHaveBeenCalledWith("Beach");
  });
});

describe("AlbumCollectionFilter", () => {
  const onChange = vi.fn<(filter: CollectionFilter) => void>();
  const onManage = vi.fn<() => void>();
  const counts = { byCollection: new Map([[travel.id, 2]]), none: 4, all: 6 };

  const renderFilter = (collections: AlbumCollection[], value: CollectionFilter = undefined) =>
    render(
      <AlbumCollectionFilter
        collections={collections}
        counts={counts}
        value={value}
        onChange={onChange}
        onManage={onManage}
      />
    );

  function chip(name: string): HTMLInputElement {
    const radios = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const found = radios.find(radio => document.querySelector(`label[for="${radio.id}"]`)?.textContent === name);
    return defined(found, `chip ${name}`);
  }

  it("shows All, each collection and Not in a collection with their counts", async () => {
    await renderFilter([family, travel], travel.id);

    expect(chip("Travel2").checked).toBe(true);
    expect(chip("All6").checked).toBe(false);
    expect(chip("Family0").checked).toBe(false);
    expect(chip("Not in a collection4").checked).toBe(false);
  });

  it("filters by the chip picked", async () => {
    await renderFilter([family, travel]);

    await click(chip("Family0"));
    expect(onChange).toHaveBeenLastCalledWith(5);
    await click(chip("Not in a collection4"));
    expect(onChange).toHaveBeenLastCalledWith("none");
  });

  it("goes back to every album from All", async () => {
    await renderFilter([family, travel], travel.id);

    await click(chip("All6"));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("opens Manage collections from its menu", async () => {
    await renderFilter([family, travel]);

    await click(button("Collection actions"));
    await click(button("Manage collections…"));
    expect(onManage).toHaveBeenCalled();
  });

  it("offers to make the first collection", async () => {
    await renderFilter([]);

    expect(document.body.querySelector('input[type="radio"]')).toBeNull();
    await click(button("New collection"));
    expect(onManage).toHaveBeenCalled();
  });
});
