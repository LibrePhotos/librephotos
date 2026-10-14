/**
 * My Albums filtered by collection (#1009): the collection in the URL picks the albums the grid
 * shows and the header's count, the chip row writes it back into the URL, a collection without
 * albums says so, and a card's "Collections…" opens the checklist for that album.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import type { AlbumCollection, UserAlbumInfo } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlbumCollectionFilter } from "../../../components/album/AlbumCollectionFilter";
import type { AlbumCollectionsModal } from "../../../components/album/AlbumCollectionsModal";
import type { UserAlbumCard } from "../../../components/album/UserAlbumCard";
import type { EmptyState } from "../../../components/common/EmptyState";
import type { PageHeader } from "../../../components/PageHeader";
import i18n from "../../../i18n";
import { defined } from "../../../util/defined.test-utils";

type FilterProps = React.ComponentProps<typeof AlbumCollectionFilter>;
type ChecklistProps = React.ComponentProps<typeof AlbumCollectionsModal>;
type CardProps = React.ComponentProps<typeof UserAlbumCard>;
type HeaderProps = React.ComponentProps<typeof PageHeader>;
type EmptyProps = React.ComponentProps<typeof EmptyState>;
type GridProps = { items: UserAlbumInfo[]; renderItem: (album: UserAlbumInfo, size: number) => React.ReactNode };
type Search = { collection?: number | "none" };

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  search: {} as Search,
  navigate: vi.fn<(options: { search: Search }) => Promise<void>>(),
  albums: [] as UserAlbumInfo[],
  collections: [] as AlbumCollection[],
  filter: undefined as FilterProps | undefined,
  checklist: undefined as ChecklistProps | undefined,
  header: undefined as HeaderProps | undefined,
  empty: undefined as EmptyProps | undefined,
  grid: undefined as GridProps | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: React.ComponentType }) => {
    stubs.component = options.component;
    return { useSearch: () => stubs.search, useNavigate: () => stubs.navigate };
  },
}));
vi.mock("../../../api_client/albums/hooks", () => ({
  useFetchUserAlbumsQuery: () => ({
    data: stubs.albums,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: () => Promise.resolve(),
  }),
  useToggleUserAlbumLockedMutation: () => ({ mutate: () => {} }),
  useFetchAlbumCollectionsQuery: () => ({ data: stubs.collections }),
}));
vi.mock("../../../components/PageHeader", () => ({
  PageHeader: (props: HeaderProps) => {
    stubs.header = props;
    return null;
  },
}));
vi.mock("../../../components/common/EmptyState", () => ({
  EmptyState: (props: EmptyProps) => {
    stubs.empty = props;
    return null;
  },
}));
vi.mock("../../../components/virtual/TileGrid", () => ({
  TileGrid: (props: GridProps) => {
    stubs.grid = props;
    return null;
  },
}));
vi.mock("../../../components/album/AlbumCollectionFilter", () => ({
  AlbumCollectionFilter: (props: FilterProps) => {
    stubs.filter = props;
    return null;
  },
}));
vi.mock("../../../components/album/AlbumCollectionsModal", () => ({
  AlbumCollectionsModal: (props: ChecklistProps) => {
    stubs.checklist = props;
    return null;
  },
}));
vi.mock("../../../components/album/ManageAlbumCollectionsModal", () => ({ ManageAlbumCollectionsModal: () => null }));
vi.mock("../../../components/album/UserAlbumModals", () => ({
  RenameUserAlbumModal: () => null,
  DeleteUserAlbumModal: () => null,
}));
vi.mock("../../../components/sharing/ModalAlbumShare", () => ({ ModalAlbumShare: () => null }));
vi.mock("../../../hooks/useAlbumListGridConfig", () => ({ useAlbumListGridConfig: () => ({}) }));

const album = (id: number, title: string, collection_ids: number[]): UserAlbumInfo => ({
  id,
  title,
  collection_ids,
  cover_photo: null,
  photo_count: 3,
  owner: { id: 1, username: "maria", first_name: "", last_name: "" },
  shared_to: [],
  created_on: "2026-10-01T00:00:00Z",
  favorited: false,
  locked: false,
});

const travel = { id: 3, name: "Travel" };
const family = { id: 5, name: "Family" };

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  await import("./user.index");
}, 30_000);

let root: Root | undefined;

beforeEach(() => {
  stubs.search = {};
  stubs.navigate.mockReset();
  stubs.albums = [album(1, "Porto", [3]), album(2, "Tuscany", [3, 5]), album(4, "Garden", [])];
  stubs.collections = [family, travel];
  stubs.filter = undefined;
  stubs.checklist = undefined;
  stubs.header = undefined;
  stubs.empty = undefined;
  stubs.grid = undefined;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

async function render() {
  const Page = defined(stubs.component, "user.index handed no component to createFileRoute");
  root = createRoot(document.createElement("div"));
  await act(async () => defined(root).render(<Page />));
}

const shownTitles = () => defined(stubs.grid).items.map(shown => shown.title);

describe("My Albums by collection", () => {
  it("shows every album, and the chip counts, without a collection in the URL", async () => {
    await render();

    expect(shownTitles()).toEqual(["Porto", "Tuscany", "Garden"]);
    expect(stubs.header?.subtitle).toBe("3 albums");
    const filter = defined(stubs.filter);
    expect(filter.value).toBeUndefined();
    expect(filter.counts).toMatchObject({ none: 1, all: 3 });
    expect(Object.fromEntries(filter.counts.byCollection)).toEqual({ 3: 2, 5: 1 });
  });

  it("shows the albums of the collection in the URL", async () => {
    stubs.search = { collection: 3 };
    await render();

    expect(shownTitles()).toEqual(["Porto", "Tuscany"]);
    expect(stubs.header?.subtitle).toBe("2 albums in Travel");
  });

  it("shows the albums in no collection", async () => {
    stubs.search = { collection: "none" };
    await render();

    expect(shownTitles()).toEqual(["Garden"]);
    expect(stubs.header?.subtitle).toBe("1 album not in a collection");
  });

  it("shows every album when the collection in the URL is gone", async () => {
    stubs.search = { collection: 9 };
    await render();

    expect(shownTitles()).toHaveLength(3);
    expect(defined(stubs.filter).value).toBeUndefined();
  });

  it("says so for a collection without albums", async () => {
    stubs.collections = [...stubs.collections, { id: 7, name: "Empty" }];
    stubs.search = { collection: 7 };
    await render();

    expect(stubs.grid).toBeUndefined();
    expect(stubs.empty?.title).toBe("No albums here");
  });

  it("writes the picked chip into the URL", async () => {
    await render();
    const filter = defined(stubs.filter);

    act(() => filter.onChange(5));
    act(() => filter.onChange(undefined));

    expect(stubs.navigate.mock.calls).toEqual([[{ search: { collection: 5 } }], [{ search: {} }]]);
  });

  it("opens a card's collections checklist with that album's collections", async () => {
    await render();
    const card = defined(stubs.grid).renderItem(defined(stubs.albums[1]), 140);
    if (!React.isValidElement<CardProps>(card)) throw new Error("no album card");

    await act(async () => card.props.onCollections?.("2", "Tuscany"));

    expect(stubs.checklist).toMatchObject({ opened: true, albumId: "2", albumTitle: "Tuscany", collectionIds: [3, 5] });
  });

  it("has no chip row without albums", async () => {
    stubs.albums = [];
    await render();

    expect(stubs.filter).toBeUndefined();
  });
});
