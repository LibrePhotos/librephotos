/**
 * The lightbox toolbar: every button is named (a tooltip is no accessible
 * name), the trash button restores a photo that is already in the trash
 * instead of trashing it again, and the less used actions are labelled items
 * of one ⋮ menu, on a phone as on a wide screen. The rating control follows the user's rating style
 * (#2202): the favorite toggle (F) or five stars (0-5), never both.
 */
import type { Photo, User } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import type { LightboxControlsProps } from "./lightbox.types";
import { createLightboxCommands, LightboxCommandsContext } from "./lightboxCommands";
import { LightboxControls } from "./LightboxControls";
import { makePhoto } from "./photoFixture.test-utils";

/** The lightbox the toolbar is in; the shortcuts reach it as commands. */
const lightbox = createLightboxCommands();

type StubUser = Pick<User, "id" | "favorite_min_rating" | "rating_mode">;
const FAVORITE_USER: StubUser = { id: 1, favorite_min_rating: 4, rating_mode: "favorite" };

const stubs = vi.hoisted(() => ({
  markDeleted:
    vi.fn<(variables: { image_hashes: string[]; deleted: boolean }, options: { onSuccess: () => void }) => void>(),
  setFavorite: vi.fn<(variables: { image_hashes: string[]; favorite: boolean }) => void>(),
  setRating: vi.fn<(variables: { image_hashes: string[]; rating: number }) => void>(),
  setArchived: vi.fn<(variables: { image_hashes: string[]; archived: boolean }) => void>(),
  user: undefined as StubUser | undefined,
}));

// The Files items have their own tests (FileActionItems.test.tsx); here they show what they got.
vi.mock("../photolist/FileActionItems", () => ({
  FileActionItems: ({ photoIds }: { photoIds: string[] }) => <span data-file-actions={photoIds.join(",")} />,
}));
// So are an edited photo's downloads (EditedDownloadItems.test.tsx), whose toasts load the app's i18n.
vi.mock("./EditedDownloadItems", () => ({ EditedDownloadItems: () => null }));
vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoSharesQuery: () => ({ data: [] }),
  useMarkPhotosDeletedMutation: () => ({ mutate: stubs.markDeleted }),
  useSetFavoritePhotosMutation: () => ({ mutate: stubs.setFavorite }),
  useSetPhotosRatingMutation: () => ({ mutate: stubs.setRating, isPending: false }),
  useSetPhotosHiddenMutation: () => ({ mutate: () => {} }),
  useSetPhotosArchivedMutation: () => ({ mutate: stubs.setArchived }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.user }),
}));
vi.mock("../sharing/PhotoShareLinkModal", () => ({ PhotoShareLinkModal: () => null }));

beforeAll(() => {
  stubs.user = FAVORITE_USER;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has neither; the interval picker's dropdown uses both.
  globalThis.ResizeObserver = class ResizeObserverStub implements ResizeObserver {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  Element.prototype.scrollIntoView = () => {};
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
});

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await defined(mounted.pop())();
  stubs.markDeleted.mockClear();
  stubs.setFavorite.mockClear();
  stubs.setRating.mockClear();
  stubs.setArchived.mockClear();
  stubs.user = FAVORITE_USER;
});

const photo: Partial<Photo> = { id: "p1", image_hash: "h1", hidden: false, rating: 0, in_trashcan: false };

async function renderControls(props: Partial<LightboxControlsProps> & { photo?: Partial<Photo> } = {}) {
  const { photo: photoOverride, ...rest } = props;
  // Inside the lightbox's body, as ContentViewer renders it.
  const container = document.createElement("div");
  container.className = "mantine-Modal-body";
  container.tabIndex = -1;
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <LightboxCommandsContext.Provider value={lightbox}>
          <LightboxControls
            photoDetail={makePhoto({ ...photo, ...photoOverride })}
            isPhotoDetailsLoading={false}
            lightboxSidebarShow={false}
            setLightBoxSidebarShow={() => {}}
            isPublic={false}
            enableZoom
            type="photo"
            isZoomed={false}
            toggleZoom={() => {}}
            onCloseRequest={() => {}}
            onRotate={() => {}}
            playing={false}
            setPlaying={() => {}}
            isFullscreen={false}
            toggleFullscreen={() => {}}
            isSlideshowActive={false}
            toggleSlideshow={() => {}}
            slideshowInterval={5}
            setSlideshowInterval={() => {}}
            slideshowProgress={0}
            hasOcrText={false}
            showOcrText={false}
            toggleOcrText={() => {}}
            onCopyToClipboard={() => {}}
            {...rest}
          />
        </LightboxCommandsContext.Provider>
      </MantineProvider>
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

const labels = (container: HTMLElement) =>
  [...container.querySelectorAll("button")].map(button => button.getAttribute("aria-label"));

/** Opens the toolbar's ⋮ and returns the labels of its items. */
async function openMenu(container: HTMLElement) {
  await act(async () => {
    defined(container.querySelector<HTMLButtonElement>('[aria-label="lightbox.toolbar.moreActions"]')).click();
  });
  return [...container.querySelectorAll('[role="menuitem"]')].map(item => item.textContent);
}

const menuItem = (container: HTMLElement, label: string) =>
  defined(
    [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === label),
    label
  );

describe("LightboxControls", () => {
  it("names every button, and keeps the row to back, share, favorite, info, trash and ⋮", async () => {
    const container = await renderControls();

    expect(labels(container).every(Boolean)).toBe(true);
    expect(labels(container)).toEqual([
      "lightbox.controls.close",
      "sharing.shareLinkShortcut",
      "lightbox.toolbar.addToFavorites",
      "lightbox.toolbar.showInfoPanel",
      "lightbox.toolbar.deletePhoto",
      "lightbox.toolbar.moreActions",
    ]);
  });

  it("keeps the rest in the ⋮ menu, with labels", async () => {
    const container = await renderControls();

    expect(await openMenu(container)).toEqual([
      "lightbox.controls.zoomin",
      "lightbox.controls.slideshow",
      "lightbox.controls.copy",
      "lightbox.controls.fullscreen",
      "lightbox.toolbar.hidePhoto",
      "lightbox.toolbar.archivePhoto",
      "lightbox.toolbar.rotateCCW",
      "lightbox.toolbar.rotateCW",
    ]);
  });

  it("on a phone keeps back, favorite and ⋮ on top and puts share, info and delete in a bottom bar", async () => {
    const desktop = window.matchMedia;
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: query === "(max-width: 599px)",
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    try {
      const container = await renderControls();
      expect(labels(container)).toEqual([
        "lightbox.controls.close",
        "lightbox.toolbar.addToFavorites",
        "lightbox.toolbar.moreActions",
        "sharing.shareLinkShortcut",
        "lightbox.toolbar.showInfoPanel",
        "lightbox.toolbar.deletePhoto",
      ]);
    } finally {
      window.matchMedia = desktop;
    }
  });

  it("moves a photo to the trash and then lets the viewer move on", async () => {
    const onAfterTrashToggle = vi.fn<() => void>();
    const container = await renderControls({ onAfterTrashToggle });

    await act(async () => {
      defined(container.querySelector<HTMLButtonElement>('[aria-label="lightbox.toolbar.deletePhoto"]')).click();
    });

    expect(stubs.markDeleted).toHaveBeenCalledWith({ image_hashes: ["h1"], deleted: true }, expect.anything());
    defined(stubs.markDeleted.mock.calls[0])[1].onSuccess();
    expect(onAfterTrashToggle).toHaveBeenCalledTimes(1);
  });

  it("restores a photo that is already in the trash, by button and by D", async () => {
    const container = await renderControls({ photo: { in_trashcan: true } });

    expect(container.querySelector('[aria-label="lightbox.toolbar.deletePhoto"]')).toBeNull();
    await act(async () => {
      defined(container.querySelector<HTMLButtonElement>('[aria-label="lightbox.toolbar.restorePhoto"]')).click();
    });
    await act(async () => {
      lightbox.emit("delete");
    });

    expect(stubs.markDeleted).toHaveBeenCalledTimes(2);
    stubs.markDeleted.mock.calls.forEach(([request]) =>
      expect(request).toEqual({ image_hashes: ["h1"], deleted: false })
    );
  });

  it("archives a photo from the menu and by A, and unarchives an archived one (#545)", async () => {
    const container = await renderControls();
    await openMenu(container);
    await act(async () => menuItem(container, "lightbox.toolbar.archivePhoto").click());
    await act(async () => {
      lightbox.emit("archive");
    });
    expect(stubs.setArchived.mock.calls).toEqual([
      [{ image_hashes: ["h1"], archived: true }],
      [{ image_hashes: ["h1"], archived: true }],
    ]);

    const archived = await renderControls({ photo: { archived: true } });
    await openMenu(archived);
    await act(async () => menuItem(archived, "lightbox.toolbar.unarchivePhoto").click());
    expect(stubs.setArchived).toHaveBeenLastCalledWith({ image_hashes: ["h1"], archived: false });
  });

  it("offers no rotation for a video, which the server refuses to rotate", async () => {
    const container = await renderControls({ type: "video", enableZoom: false, onCopyToClipboard: undefined });

    const items = await openMenu(container);
    expect(items).not.toContain("lightbox.toolbar.rotateCW");
    expect(items).not.toContain("lightbox.toolbar.rotateCCW");
    expect(items).not.toContain("lightbox.controls.copy");
  });

  it("shows the photo actions only once the details are in", async () => {
    const noDetails = await renderControls({ photoDetail: undefined });

    expect(labels(noDetails)).toEqual([
      "lightbox.controls.close",
      "lightbox.toolbar.showInfoPanel",
      "lightbox.toolbar.moreActions",
    ]);
    expect(await openMenu(noDetails)).toEqual([
      "lightbox.controls.zoomin",
      "lightbox.controls.slideshow",
      "lightbox.controls.copy",
      "lightbox.controls.fullscreen",
    ]);
  });

  it("reports a toggle's state in its label", async () => {
    const container = await renderControls({ photo: { rating: 5 }, lightboxSidebarShow: true, isZoomed: true });
    const button = (label: string) => defined(container.querySelector(`[aria-label="${label}"]`));

    expect(button("lightbox.toolbar.removeFromFavorites").hasAttribute("aria-pressed")).toBe(false);
    expect(button("lightbox.toolbar.hideInfoPanel").hasAttribute("aria-pressed")).toBe(false);
    expect(await openMenu(container)).toContain("lightbox.controls.zoomout");
  });

  it("zooms from the ⋮, which keyboard and double click also do", async () => {
    const toggleZoom = vi.fn<() => void>();
    const container = await renderControls({ toggleZoom });
    await openMenu(container);
    await act(async () => menuItem(container, "lightbox.controls.zoomin").click());

    expect(toggleZoom).toHaveBeenCalledOnce();
  });

  it("pauses a running slideshow from the toolbar", async () => {
    const toggleSlideshow = vi.fn<() => void>();
    const container = await renderControls({ isSlideshowActive: true, toggleSlideshow });
    const pause = defined(container.querySelector<HTMLButtonElement>('[aria-label="lightbox.controls.stopslideshow"]'));

    expect(pause.hasAttribute("aria-pressed")).toBe(false);
    await act(async () => pause.click());
    expect(toggleSlideshow).toHaveBeenCalledOnce();
  });

  it("hands focus back to the lightbox once a slideshow interval is picked", async () => {
    const setSlideshowInterval = vi.fn<LightboxControlsProps["setSlideshowInterval"]>();
    const container = await renderControls({ isSlideshowActive: true, setSlideshowInterval });
    const input = defined(container.querySelector<HTMLInputElement>("input:not([type=hidden])"));

    await act(async () => {
      input.focus();
      input.click();
    });
    const option = defined(
      [...container.querySelectorAll<HTMLElement>('[role="option"]')].find(o => o.textContent === "10s")
    );
    await act(async () => option.click());

    expect(setSlideshowInterval).toHaveBeenCalledWith(10);
    // Escape and the other shortcuts skip a focused input.
    expect(document.activeElement).toBe(container);
  });

  it("gives the owner Rescan file and Detect faces again in the ⋮ (#2214, #524)", async () => {
    const container = await renderControls();
    await openMenu(container);

    expect(container.querySelector("[data-file-actions]")?.getAttribute("data-file-actions")).toBe("p1");
  });

  it("offers no file actions on a photo shared with you", async () => {
    stubs.user = { ...FAVORITE_USER, id: 2 };
    const container = await renderControls();
    await openMenu(container);

    expect(container.querySelector("[data-file-actions]")).toBeNull();
  });

  it("gives a public page only the view items, and no trash or rating", async () => {
    const container = await renderControls({ isPublic: true });

    expect(labels(container)).not.toContain("lightbox.toolbar.deletePhoto");
    expect(labels(container)).not.toContain("lightbox.toolbar.addToFavorites");
    expect(labels(container)).not.toContain("sharing.shareLinkShortcut");
    expect(await openMenu(container)).toEqual([
      "lightbox.controls.zoomin",
      "lightbox.controls.slideshow",
      "lightbox.controls.copy",
      "lightbox.controls.fullscreen",
    ]);
  });
});

describe("LightboxControls rating", () => {
  const STARS_USER: StubUser = { ...FAVORITE_USER, rating_mode: "stars" };
  const starInputs = (container: HTMLElement) => container.querySelectorAll('input[type="radio"]');

  it("toggles the favorite by button and by F in favorite mode, and ignores 0-5", async () => {
    const container = await renderControls({ photo: { rating: 5 } });

    expect(starInputs(container)).toHaveLength(0);
    await act(async () => {
      defined(
        container.querySelector<HTMLButtonElement>('[aria-label="lightbox.toolbar.removeFromFavorites"]')
      ).click();
    });
    await act(async () => {
      lightbox.emit("favorite");
      lightbox.emit("rate", 3);
    });

    expect(stubs.setFavorite).toHaveBeenCalledTimes(2);
    expect(stubs.setFavorite).toHaveBeenCalledWith({ image_hashes: ["h1"], favorite: false });
    expect(stubs.setRating).not.toHaveBeenCalled();
  });

  it("shows no photo as a favorite, and toggles nothing, before the user's settings load", async () => {
    stubs.user = undefined;
    const container = await renderControls({ photo: { rating: 5 } });

    expect(labels(container)).toContain("lightbox.toolbar.addToFavorites");
    await act(async () => lightbox.emit("favorite"));
    expect(stubs.setFavorite).not.toHaveBeenCalled();
  });

  it("shows five stars in stars mode and rates by click and by 0-5, never through the favorite toggle", async () => {
    stubs.user = STARS_USER;
    const container = await renderControls({ photo: { rating: 2 } });

    expect(labels(container)).not.toContain("lightbox.toolbar.addToFavorites");
    const radios = [...starInputs(container)];
    // Mantine's Rating has a hidden 0 ("clear") input before the five stars.
    expect(radios.map(radio => radio.getAttribute("aria-label"))).toEqual([
      "lightbox.toolbar.clearRating",
      ...Array<string>(5).fill("lightbox.toolbar.rateStars"),
    ]);
    await act(async () => {
      defined(container.querySelectorAll<HTMLLabelElement>("label")[4]).click();
    });
    await act(async () => {
      lightbox.emit("rate", 0);
      lightbox.emit("favorite");
    });

    expect(stubs.setRating.mock.calls.map(([request]) => request)).toEqual([
      { image_hashes: ["h1"], rating: 4 },
      { image_hashes: ["h1"], rating: 0 },
    ]);
    expect(stubs.setFavorite).not.toHaveBeenCalled();
  });

  it("clears the rating when the current star is clicked again", async () => {
    stubs.user = STARS_USER;
    const container = await renderControls({ photo: { rating: 3 } });

    await act(async () => {
      defined(container.querySelectorAll<HTMLLabelElement>("label")[3]).click();
    });

    expect(stubs.setRating).toHaveBeenCalledWith({ image_hashes: ["h1"], rating: 0 });
  });

  it("shows the owner's rating read-only on a photo shared with you", async () => {
    stubs.user = { ...STARS_USER, id: 2 };
    const container = await renderControls({ photo: { rating: 4 } });

    expect(starInputs(container)).toHaveLength(0);
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("lightbox.toolbar.ratedStars");
    await act(async () => lightbox.emit("rate", 5));
    expect(stubs.setRating).not.toHaveBeenCalled();
  });
});

describe("LightboxControls 360° view (#483)", () => {
  const panorama = (active: boolean) => ({
    available: true,
    blockedReason: undefined,
    active,
    toggle: vi.fn<() => void>(),
    exit: () => {},
    fail: () => {},
  });
  const button = (container: HTMLElement, name: string) =>
    defined(container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`), name);

  it("shows no toggle for a flat photo", async () => {
    const container = await renderControls();

    expect(labels(container)).not.toContain("lightbox.panorama.toggle");
  });

  it("puts the toggle before live text", async () => {
    const container = await renderControls({ panorama: panorama(false), hasOcrText: true });

    const names = labels(container);
    expect(names.indexOf("lightbox.panorama.toggle")).toBeLessThan(names.indexOf("lightbox.controls.livetext"));
  });

  it("keeps live text and zoom in place in the 360° view, saying why they do nothing", async () => {
    const toggleZoom = vi.fn<() => void>();
    const container = await renderControls({ panorama: panorama(true), hasOcrText: true, toggleZoom });

    await openMenu(container);
    const zoom = menuItem(container, "lightbox.controls.zoomin");
    await act(async () => zoom.click());

    expect(zoom.getAttribute("aria-disabled")).toBe("true");
    expect(button(container, "lightbox.controls.livetext").getAttribute("aria-disabled")).toBe("true");
    expect(toggleZoom).not.toHaveBeenCalled();
    expect(button(container, "lightbox.panorama.toggle").getAttribute("aria-pressed")).toBe("true");
  });
});
