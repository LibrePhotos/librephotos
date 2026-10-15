/**
 * The user album page (#2208, #2210): the owner gets the album's menu (rename, sharing, lock,
 * delete) and a "Locked" badge on a locked album; someone it is shared with gets the menu with
 * "Leave album" instead, although their view is otherwise read-only (`isPublic`).
 *
 * Uploading into the album (#612): only the owner's album gets an upload (its menu item, the
 * page's drop target and the empty album's drop zone); an empty album says how to fill it.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import type { UserAlbum } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotoListView } from "../../../components/photolist/PhotoListView";
import type { AlbumUpload, UploadableAlbum } from "../../../components/upload/useAlbumUpload";
import i18n from "../../../i18n";

type PhotoListViewProps = React.ComponentProps<typeof PhotoListView>;

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  album: undefined as UserAlbum | undefined,
  isError: false,
  currentUser: undefined as { id: number } | undefined,
  listProps: undefined as PhotoListViewProps | undefined,
  uploadFor: [] as (UploadableAlbum | null)[],
  upload: null as AlbumUpload | null,
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
vi.mock("../../../components/photolist/mediaTypeFilter", () => ({
  DEFAULT_MEDIA_TYPE: "all",
  validateMediaSearch: () => ({}),
}));
vi.mock("../../../components/upload/useAlbumUpload", () => ({
  useAlbumUpload: (album: UploadableAlbum | null) => {
    stubs.uploadFor.push(album);
    return album ? stubs.upload : null;
  },
}));

const openPicker = vi.fn<() => void>();

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
  stubs.uploadFor = [];
  stubs.upload = { open: openPicker, reason: null, inputProps: {} };
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
  if (
    !React.isValidElement<{ album: UserAlbum; upload?: AlbumUpload | null }>(menu) ||
    typeof menu.type !== "function"
  ) {
    throw new Error("no album menu");
  }
  return { name: menu.type.name, album: menu.props.album, upload: menu.props.upload };
}

describe("the user album page", () => {
  it("gives the owner the album's menu, and no Locked badge on an open album", async () => {
    const props = await render();

    expect(menuOf(props)).toEqual({ name: "UserAlbumHeaderMenu", album: lisbon, upload: stubs.upload });
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

    expect(menuOf(props)).toEqual({ name: "SharedAlbumHeaderMenu", album: stubs.album, upload: undefined });
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

  describe("uploading into the album (#612)", () => {
    it("lets the owner upload into their album, and makes the empty album a drop zone", async () => {
      const props = await render();

      expect(stubs.uploadFor.at(-1)).toEqual({ id: 7, title: "Lisbon 2026", locked: false });
      expect(props.emptyStateConfig).toMatchObject({ title: "This album is empty", dropZone: true });
      expect(props.emptyStateConfig?.actionLabel).toBe("Upload photos");
      props.emptyStateConfig?.onAction?.();
      expect(openPicker).toHaveBeenCalledTimes(1);
    });

    it("says why a locked empty album takes no uploads", async () => {
      stubs.album = { ...lisbon, locked: true };
      stubs.upload = { open: openPicker, reason: "Lisbon 2026 is locked. Unlock it to add photos.", inputProps: {} };

      const props = await render();

      expect(stubs.uploadFor.at(-1)).toEqual({ id: 7, title: "Lisbon 2026", locked: true });
      expect(props.emptyStateConfig?.description).toBe("Lisbon 2026 is locked. Unlock it to add photos.");
      expect(props.emptyStateConfig?.actionLabel).toBeUndefined();
      expect(props.emptyStateConfig?.dropZone).toBeUndefined();
    });

    it("tells how to fill the album from the library when uploads are off", async () => {
      stubs.upload = null;

      const props = await render();

      expect(props.emptyStateConfig?.description).toMatch(/open the \+ menu and choose Album/);
      expect(props.emptyStateConfig?.actionLabel).toBeUndefined();
    });

    it("gives an album shared with you no upload and no empty-album state", async () => {
      stubs.currentUser = { id: 2 };

      const props = await render();

      expect(stubs.uploadFor.every(album => album === null)).toBe(true);
      expect(props.emptyStateConfig).toBeUndefined();
    });
  });
});
