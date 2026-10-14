/**
 * My Albums told a user whose server was down (proxy answering 502) "No albums
 * yet": the page only checked `isLoading` and an empty list, so a failed request
 * read like lost albums, with no way to try again short of a reload (#2221).
 * Its New album button (#612) makes an empty album and opens it; with a collection chosen
 * (#1009), the album goes into that collection first.
 * The leading "-" keeps the router plugin from taking this for a route.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CreateUserAlbumModal } from "../../../components/album/UserAlbumModals";
import i18n from "../../../i18n";
import { defined } from "../../../util/defined.test-utils";

type CreateProps = React.ComponentProps<typeof CreateUserAlbumModal>;
type SetCollections = { albumId: number | string; collectionIds: number[] };

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  navigate: vi.fn<(options: { to: string; params?: { id: string } }) => Promise<void>>(),
  create: undefined as CreateProps | undefined,
  search: {} as { collection?: number | "none" },
  collections: [] as { id: number; name: string }[],
  setCollections: vi.fn<(params: SetCollections, options: { onSettled: () => void }) => void>(),
  refetch: vi.fn<() => Promise<unknown>>(),
  albums: { data: undefined as unknown[] | undefined, isLoading: false, isFetching: false, isError: false },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options?: { component?: React.ComponentType }) => {
    stubs.component = options?.component;
    return { useSearch: () => stubs.search, useNavigate: () => () => Promise.resolve() };
  },
  useNavigate: () => stubs.navigate,
}));
vi.mock("../../../api_client/albums/hooks", () => ({
  useFetchUserAlbumsQuery: () => ({ ...stubs.albums, refetch: stubs.refetch }),
  useToggleUserAlbumLockedMutation: () => ({ mutate: () => {} }),
  useFetchAlbumCollectionsQuery: () => ({ data: stubs.collections }),
  useSetUserAlbumCollectionsMutation: () => ({ mutate: stubs.setCollections }),
  useDeleteAlbumCollectionMutation: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("../../../components/album/UserAlbumModals", () => ({
  CreateUserAlbumModal: (props: CreateProps) => {
    stubs.create = props;
    return null;
  },
  DeleteUserAlbumModal: () => null,
  RenameUserAlbumModal: () => null,
}));
vi.mock("../../../components/sharing/ModalAlbumShare", () => ({ ModalAlbumShare: () => null }));
vi.mock("../../../components/virtual/TileGrid", () => ({
  TileGrid: ({ items }: { items: unknown[] }) => <div data-testid="grid">{items.length}</div>,
}));

let root: Root | undefined;
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
  await i18n.changeLanguage("en");
  await import("./user.index");
}, 30_000);

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  stubs.refetch.mockReset();
});

async function renderPage() {
  const AlbumUser = defined(stubs.component);
  container = document.createElement("div");
  document.body.appendChild(container);
  const pageRoot = createRoot(container);
  root = pageRoot;
  await act(async () => {
    pageRoot.render(
      <MantineProvider>
        <AlbumUser />
      </MantineProvider>
    );
  });
}

function retryButton() {
  return [...container.querySelectorAll("button")].find(b => b.textContent === i18n.t("errorstate.retry"));
}

describe("My Albums", () => {
  it("shows an error with Retry, not the empty state, when the list failed", async () => {
    stubs.albums = { data: undefined, isLoading: false, isFetching: false, isError: true };
    await renderPage();

    expect(container.textContent).not.toContain(i18n.t("emptystate.useralbums.title"));
    expect(container.textContent).toContain(i18n.t("errorstate.title"));
    await act(async () => defined(retryButton()).click());
    expect(stubs.refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the albums on screen when only a background refetch failed", async () => {
    stubs.albums = { data: [{ id: 1, collection_ids: [] }], isLoading: false, isFetching: false, isError: true };
    await renderPage();

    expect(container.querySelector("[data-testid=grid]")?.textContent).toBe("1");
    expect(retryButton()).toBeUndefined();
  });

  it("still says there are none when the list is really empty", async () => {
    stubs.albums = { data: [], isLoading: false, isFetching: false, isError: false };
    await renderPage();

    expect(container.textContent).toContain(i18n.t("emptystate.useralbums.title"));
    expect(retryButton()).toBeUndefined();
  });

  it("makes a new, empty album and opens it (#612)", async () => {
    stubs.albums = {
      data: [{ id: 1, title: "Porto", collection_ids: [] }],
      isLoading: false,
      isFetching: false,
      isError: false,
    };
    await renderPage();
    expect(defined(stubs.create).opened).toBe(false);

    const button = [...container.querySelectorAll("button")].find(b => b.textContent === "New album");
    await act(async () => defined(button).click());

    const dialog = defined(stubs.create);
    expect(dialog.opened).toBe(true);
    expect(dialog.existingTitles).toEqual(["Porto"]);
    expect(dialog.collectionName).toBeUndefined();
    dialog.onCreated({ id: 12, title: "Iceland 2026" });
    expect(stubs.setCollections).not.toHaveBeenCalled();
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/album/user/$id", params: { id: "12" } });
  });

  it("puts an album made while a collection is chosen into that collection, then opens it", async () => {
    stubs.collections = [{ id: 3, name: "Travel" }];
    stubs.search = { collection: 3 };
    stubs.albums = {
      data: [{ id: 1, title: "Porto", collection_ids: [3] }],
      isLoading: false,
      isFetching: false,
      isError: false,
    };
    stubs.navigate.mockClear();
    await renderPage();

    const dialog = defined(stubs.create);
    expect(dialog.collectionName).toBe("Travel");
    dialog.onCreated({ id: 12, title: "Iceland 2026" });

    const [params, options] = defined(stubs.setCollections.mock.calls[0]);
    expect(params).toEqual({ albumId: 12, collectionIds: [3] });
    expect(stubs.navigate).not.toHaveBeenCalled();
    options.onSettled();
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/album/user/$id", params: { id: "12" } });
    stubs.collections = [];
    stubs.search = {};
  });
});
