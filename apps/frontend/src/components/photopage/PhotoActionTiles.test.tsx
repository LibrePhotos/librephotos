/**
 * The owner's action tiles: labelled buttons wired to the shared photo
 * actions, Download straight to the original or through a menu of formats,
 * and More with the rest of the lightbox's toolbar.
 */
import type { Photo } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { makePhoto } from "../lightbox/photoFixture.test-utils";
import type { PhotoActions } from "../lightbox/usePhotoActions";
import type { AlbumEditModal } from "../modals/AlbumEdit/AlbumEditModal";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import type { MovePhotosModal } from "../movephotos/MovePhotosModal";
import { PhotoActionTiles } from "./PhotoActionTiles";

const stubs = vi.hoisted(() => {
  const album: React.ComponentProps<typeof AlbumEditModal>[] = [];
  const move: React.ComponentProps<typeof MovePhotosModal>[] = [];
  return { album, move };
});

// The Files items have their own tests (FileActionItems.test.tsx).
vi.mock("../photolist/FileActionItems", () => ({ FileActionItems: () => null, SelectionFileItems: () => null }));
vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../modals/AlbumEdit/AlbumEditModal", () => ({
  AlbumEditModal: (props: React.ComponentProps<typeof AlbumEditModal>) => {
    stubs.album.push(props);
    return null;
  },
}));
vi.mock("../sharing/PhotoShareLinkModal", () => ({ PhotoShareLinkModal: () => null }));
vi.mock("../movephotos/MovePhotosModal", () => ({
  MovePhotosModal: (props: React.ComponentProps<typeof MovePhotosModal>) => {
    stubs.move.push(props);
    return null;
  },
}));

beforeAll(setUpMantineDom);

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await defined(mounted.pop())();
  stubs.album.length = 0;
  stubs.move.length = 0;
});

function makeActions(overrides: Partial<PhotoActions> = {}): PhotoActions {
  return {
    isFavorite: false,
    toggleFavorite: vi.fn<() => void>(),
    ratesWithStars: false,
    canRate: false,
    rating: 0,
    setRating: vi.fn<(rating: number) => void>(),
    isHidden: false,
    toggleHidden: vi.fn<() => void>(),
    isArchived: false,
    toggleArchived: vi.fn<() => void>(),
    isShared: false,
    sharingPhotoId: null,
    openShareLink: vi.fn<() => void>(),
    closeShareLink: vi.fn<() => void>(),
    inTrash: false,
    toggleTrash: vi.fn<() => void>(),
    isOwner: true,
    ...overrides,
  };
}

type RenderProps = Partial<React.ComponentProps<typeof PhotoActionTiles>> & { photo?: Photo };

async function renderTiles(props: RenderProps = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const all = {
    photo: makePhoto({ id: "p1", image_hash: "h1", image_path: ["/lib/IMG_1.jpg"] }),
    actions: makeActions(),
    onOpenViewer: vi.fn<() => void>(),
    ...props,
  };
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <PhotoActionTiles {...all} />
      </MantineProvider>
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return { container, ...all };
}

function byText(root: ParentNode, selector: string, text: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>(selector)].find(el => el.textContent?.trim() === text);
  if (!found) throw new Error(`no ${selector} "${text}"`);
  return found;
}

/** Open More and return its menu's item texts. */
async function openMore(container: HTMLElement): Promise<string[]> {
  await act(async () => byText(container, "button", "photopage.tiles.more").click());
  return [...document.querySelectorAll('[role="menuitem"]')].map(el => el.textContent?.trim() ?? "");
}

describe("photo action tiles", () => {
  it("toggles the favourite and says whether it is one", async () => {
    const actions = makeActions({ isFavorite: true });
    const { container } = await renderTiles({ actions });
    const favorite = byText(container, "button", "photopage.tiles.favorite");
    expect(favorite.getAttribute("aria-pressed")).toBe("true");
    expect(favorite.title).toBe("photopage.actions.unfavorite");
    await act(async () => favorite.click());
    expect(actions.toggleFavorite).toHaveBeenCalledTimes(1);
  });

  it("shows the stars instead of Favorite in stars mode, and rates by click (#2202)", async () => {
    const actions = makeActions({ ratesWithStars: true, canRate: true, rating: 2 });
    const { container } = await renderTiles({ actions });
    expect(container.textContent).not.toContain("photopage.tiles.favorite");
    expect(container.textContent).toContain("photopage.tiles.rating");
    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
    // Mantine's Rating puts a hidden 0 before the five stars: label 4 is the 4th star.
    await act(async () =>
      defined(container.querySelectorAll<HTMLLabelElement>(".mantine-Rating-root label")[4]).click()
    );
    expect(actions.setRating).toHaveBeenCalledWith(4);
  });

  it("opens the share link and the album picker for this photo", async () => {
    const actions = makeActions({ isShared: true });
    const { container } = await renderTiles({ actions });
    const share = byText(container, "button", "photopage.tiles.share");
    expect(share.hasAttribute("data-shared")).toBe(true);
    await act(async () => share.click());
    expect(actions.openShareLink).toHaveBeenCalledTimes(1);

    await act(async () => byText(container, "button", "photopage.tiles.album").click());
    const album = defined(stubs.album.at(-1));
    expect(album.isOpen).toBe(true);
    expect(album.selectedImages).toEqual([{ id: "p1", image_hash: "h1", type: "image" }]);
  });

  it("downloads the original straight away when the photo has one file", async () => {
    const { container } = await renderTiles();
    const download = byText(container, "a", "photopage.tiles.download");
    expect(download.getAttribute("href")).toContain("h1");
    expect(download.getAttribute("download")).toBe("IMG_1.jpg");
  });

  it("lists the original and every other format to download", async () => {
    const photo = makePhoto({
      id: "p1",
      image_hash: "h1",
      image_path: ["/lib/IMG_1.jpg"],
      file_variants: [
        { hash: "h1", path: "/lib/IMG_1.jpg", type: "image", type_id: 1, is_main: true, filename: "IMG_1.jpg" },
        { hash: "raw1", path: "/lib/IMG_1.RAF", type: "raw", type_id: 3, is_main: false, filename: null },
      ],
    });
    const { container } = await renderTiles({ photo });
    await act(async () => byText(container, "button", "photopage.tiles.download").click());
    const items = [...document.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"]')];
    expect(items.map(item => item.getAttribute("download"))).toEqual(["IMG_1.jpg", "IMG_1.RAF"]);
  });

  it("keeps copy, rotation, hiding, archiving, the viewer and the trash under More", async () => {
    const actions = makeActions();
    const onRotate = vi.fn<(angle: number) => void>();
    const onCopy = vi.fn<() => void>();
    const { container, onOpenViewer } = await renderTiles({ actions, onRotate, onCopy });
    expect(await openMore(container)).toEqual([
      "photopage.more.copy",
      "lightbox.toolbar.rotateCCW",
      "lightbox.toolbar.rotateCW",
      "photopage.actions.hide",
      "photopage.actions.archive",
      "selectionactions.movetofolder",
      "photopage.openinviewer",
      "photopage.actions.trash",
    ]);
    await act(async () => byText(document, '[role="menuitem"]', "photopage.actions.archive").click());
    expect(actions.toggleArchived).toHaveBeenCalledTimes(1);

    await openMore(container);
    await act(async () => byText(document, '[role="menuitem"]', "lightbox.toolbar.rotateCW").click());
    expect(onRotate).toHaveBeenCalledWith(90);

    await openMore(container);
    await act(async () => byText(document, '[role="menuitem"]', "photopage.actions.trash").click());
    expect(actions.toggleTrash).toHaveBeenCalledTimes(1);

    await openMore(container);
    await act(async () => byText(document, '[role="menuitem"]', "photopage.openinviewer").click());
    expect(onOpenViewer).toHaveBeenCalledTimes(1);
  });

  it("offers neither copy nor rotation where they cannot work, and restores from the trash", async () => {
    const { container } = await renderTiles({ actions: makeActions({ inTrash: true, isHidden: true }) });
    const items = await openMore(container);
    expect(items).not.toContain("photopage.more.copy");
    expect(items).not.toContain("lightbox.toolbar.rotateCW");
    expect(items).toContain("photopage.actions.show");
    expect(items).toContain("photopage.actions.restore");
  });

  it("moves the photo to another folder from More, marking the folder it is in (#352)", async () => {
    const { container } = await renderTiles();
    expect(stubs.move).toEqual([]);

    await openMore(container);
    await act(async () => byText(document, '[role="menuitem"]', "selectionactions.movetofolder").click());

    expect(stubs.move.at(-1)).toMatchObject({
      opened: true,
      selection: { image_hashes: ["h1"] },
      currentFolder: "/lib",
    });
  });
});
