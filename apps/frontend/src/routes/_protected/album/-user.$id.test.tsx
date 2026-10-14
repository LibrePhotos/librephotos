/**
 * The user album page (#2208, #2210): the owner gets the album's menu (rename, sharing, lock,
 * delete) and a "Locked" badge on a locked album; someone it is shared with gets the menu with
 * "Leave album" instead, although their view is otherwise read-only (`isPublic`).
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import type { UserAlbum } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotoListView } from "../../../components/photolist/PhotoListView";
import i18n from "../../../i18n";

type PhotoListViewProps = React.ComponentProps<typeof PhotoListView>;

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  album: undefined as UserAlbum | undefined,
  isError: false,
  currentUser: undefined as { id: number } | undefined,
  listProps: undefined as PhotoListViewProps | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    const route = (options?: { component?: React.ComponentType }) => {
      stubs.component = options?.component;
      return route;
    };
    route.useParams = () => ({ id: "7" });
    return route;
  },
}));
vi.mock("../../../api_client/albums/hooks", () => ({
  useFetchUserAlbumQuery: () => ({ data: stubs.album, isLoading: false, isError: stubs.isError }),
}));
vi.mock("../../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.currentUser }),
}));
// The menus have their own tests; here it only matters which one the page passes, for which album.
vi.mock("../../../components/album/UserAlbumHeaderMenu", () => ({
  UserAlbumHeaderMenu: function UserAlbumHeaderMenu() {
    return null;
  },
}));
vi.mock("../../../components/album/SharedAlbumHeaderMenu", () => ({
  SharedAlbumHeaderMenu: function SharedAlbumHeaderMenu() {
    return null;
  },
}));
vi.mock("../../../components/photolist/PhotoListView", () => ({
  PhotoListView: (props: PhotoListViewProps) => {
    stubs.listProps = props;
    return null;
  },
}));
vi.mock("../../../components/photolist/useMediaTypeFilter", () => ({ useMediaTypeFilter: () => "all" }));
vi.mock("../../../components/photolist/mediaTypeFilter", () => ({ validateMediaSearch: () => ({}) }));

const owner = { id: 1, username: "maria", first_name: "Maria", last_name: "Santos" };

const lisbon: UserAlbum = {
  id: 7,
  title: "Lisbon 2026",
  collection_ids: [],
  owner,
  shared_to: [],
  locked: false,
  date: "2026-10-01",
  location: null,
  grouped_photos: [],
};

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  await import("./user.$id");
}, 30_000);

beforeEach(() => {
  stubs.album = lisbon;
  stubs.isError = false;
  stubs.currentUser = { id: 1 };
  stubs.listProps = undefined;
});

async function render(): Promise<PhotoListViewProps> {
  const Page = stubs.component;
  if (!Page) throw new Error("user.$id handed no component to createFileRoute");
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<Page />));
  await act(async () => root.unmount());
  if (!stubs.listProps) throw new Error("PhotoListView was not rendered");
  return stubs.listProps;
}

function menuOf(props: PhotoListViewProps) {
  const menu = props.headerActions;
  if (!React.isValidElement<{ album: UserAlbum }>(menu) || typeof menu.type !== "function") {
    throw new Error("no album menu");
  }
  return { name: menu.type.name, album: menu.props.album };
}

describe("the user album page", () => {
  it("gives the owner the album's menu, and no Locked badge on an open album", async () => {
    const props = await render();

    expect(menuOf(props)).toEqual({ name: "UserAlbumHeaderMenu", album: lisbon });
    expect(props.isPublic).toBe(false);
    expect(props.titleBadge).toBeUndefined();
  });

  it("shows the owner that the album is locked", async () => {
    stubs.album = { ...lisbon, locked: true };

    const props = await render();

    expect(props.titleBadge).toBeDefined();
    expect(props.albumLocked).toBe(true);
  });

  it("gives someone it is shared with only the Leave album menu, on a read-only view", async () => {
    stubs.currentUser = { id: 2 };
    stubs.album = { ...lisbon, locked: true };

    const props = await render();

    expect(menuOf(props)).toEqual({ name: "SharedAlbumHeaderMenu", album: stubs.album });
    expect(props.isPublic).toBe(true);
    expect(props.titleBadge).toBeUndefined();
  });

  it("offers no menu before it knows who is looking", async () => {
    stubs.currentUser = undefined;

    const props = await render();

    expect(props.headerActions).toBeUndefined();
  });

  it("offers no menu for an album that is not there", async () => {
    stubs.album = undefined;
    stubs.isError = true;

    const props = await render();

    expect(props.headerActions).toBeUndefined();
    expect(props.emptyStateConfig?.actionLink).toBe("/album/user");
  });
});
