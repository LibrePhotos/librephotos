/**
 * The lightbox toolbar: every button is named (a tooltip is no accessible
 * name), the trash button restores a photo that is already in the trash
 * instead of trashing it again, and a phone gets one row with the owner's
 * actions in a menu. The rating control follows the user's rating style
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
  narrow: false,
}));

// The Files items have their own tests (FileActionItems.test.tsx); here they show what they got.
vi.mock("../photolist/FileActionItems", () => ({
  FileActionItems: ({ photoIds }: { photoIds: string[] }) => <span data-file-actions={photoIds.join(",")} />,
}));
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
    matches: stubs.narrow && query.includes("max-width"),
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
  stubs.narrow = false;
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

describe("LightboxControls", () => {
  it("names every button", async () => {
    const container = await renderControls();

    expect(labels(container).length).toBeGreaterThan(8);
    expect(labels(container).every(Boolean)).toBe(true);
    expect(labels(container)).toEqual(
      expect.arrayContaining([
        "lightbox.toolbar.hidePhoto",
        "lightbox.toolbar.archivePhoto",
        "lightbox.toolbar.deletePhoto",
        "lightbox.toolbar.showInfoPanel",
        "lightbox.controls.close",
      ])
    );
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

  it("archives a photo by button and by A, and unarchives an archived one (#545)", async () => {
    const container = await renderControls();
    await act(async () => {
      defined(container.querySelector<HTMLButtonElement>('[aria-label="lightbox.toolbar.archivePhoto"]')).click();
    });
    await act(async () => {
      lightbox.emit("archive");
    });
    expect(stubs.setArchived.mock.calls).toEqual([
      [{ image_hashes: ["h1"], archived: true }],
      [{ image_hashes: ["h1"], archived: true }],
    ]);

    const archived = await renderControls({ photo: { archived: true } });
    await act(async () => {
      defined(archived.querySelector<HTMLButtonElement>('[aria-label="lightbox.toolbar.unarchivePhoto"]')).click();
    });
    expect(stubs.setArchived).toHaveBeenLastCalledWith({ image_hashes: ["h1"], archived: false });
  });

  it("offers no rotation for a video, which the server refuses to rotate", async () => {
    const container = await renderControls({ type: "video", enableZoom: false, onCopyToClipboard: undefined });

    expect(labels(container)).not.toContain("lightbox.toolbar.rotateCW");
    expect(labels(container)).not.toContain("lightbox.toolbar.rotateCCW");
  });

  it("puts the owner's actions in a menu on a phone", async () => {
    stubs.narrow = true;
    const container = await renderControls();

    expect(labels(container)).toContain("lightbox.toolbar.moreActions");
    expect(labels(container)).not.toContain("lightbox.toolbar.deletePhoto");
    expect(labels(container)).not.toContain("lightbox.controls.fullscreen");
    // What stays in the row.
    expect(labels(container)).toEqual(
      expect.arrayContaining([
        "lightbox.controls.slideshow",
        "lightbox.controls.zoom",
        "lightbox.toolbar.addToFavorites",
        "lightbox.toolbar.showInfoPanel",
        "lightbox.controls.close",
      ])
    );
  });

  it("puts a divider between every two groups of the row", async () => {
    // Slideshow | view | photo actions | info and close.
    const photoRow = await renderControls();
    expect(photoRow.querySelectorAll('[role="separator"]')).toHaveLength(3);

    // A video on a phone has no view group left: slideshow | favourite and menu | info and close.
    stubs.narrow = true;
    const videoRow = await renderControls({ type: "video", enableZoom: false, onCopyToClipboard: undefined });
    expect(labels(videoRow)).not.toContain("lightbox.controls.zoom");
    expect(videoRow.querySelectorAll('[role="separator"]')).toHaveLength(2);
  });

  it("drops the photo-actions group, not just its buttons, when there are no details", async () => {
    // Details that failed to load left two dividers side by side: slideshow | view | info and close.
    const noDetails = await renderControls({ photoDetail: undefined });
    expect(labels(noDetails)).not.toContain("lightbox.toolbar.addToFavorites");
    expect(noDetails.querySelectorAll('[role="separator"]')).toHaveLength(2);

    // A public page has no such group either, and still sets info and close apart.
    const publicRow = await renderControls({ isPublic: true, photoDetail: undefined });
    expect(publicRow.querySelectorAll('[role="separator"]')).toHaveLength(2);
  });

  it("reports a toggle's state once: in the label, or with aria-pressed for zoom", async () => {
    const container = await renderControls({ photo: { rating: 5 }, lightboxSidebarShow: true, isZoomed: true });
    const button = (label: string) => defined(container.querySelector(`[aria-label="${label}"]`));

    expect(button("lightbox.toolbar.removeFromFavorites").hasAttribute("aria-pressed")).toBe(false);
    expect(button("lightbox.toolbar.hideInfoPanel").hasAttribute("aria-pressed")).toBe(false);
    expect(button("lightbox.controls.slideshow").hasAttribute("aria-pressed")).toBe(false);
    expect(button("lightbox.controls.zoom").getAttribute("aria-pressed")).toBe("true");
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

  it("gives the owner a ⋮ after rotate with Rescan file and Detect faces again (#2214, #524)", async () => {
    const container = await renderControls();
    const more = defined(container.querySelector<HTMLButtonElement>('[aria-label="lightbox.toolbar.moreActions"]'));

    await act(async () => more.click());

    expect(container.querySelector("[data-file-actions]")?.getAttribute("data-file-actions")).toBe("p1");
  });

  it("puts the file actions in the phone's menu too", async () => {
    stubs.narrow = true;
    const container = await renderControls();

    await act(async () => {
      defined(container.querySelector<HTMLButtonElement>('[aria-label="lightbox.toolbar.moreActions"]')).click();
    });

    expect(container.querySelector("[data-file-actions]")?.getAttribute("data-file-actions")).toBe("p1");
  });

  it("offers no file actions on a photo shared with you", async () => {
    stubs.user = { ...FAVORITE_USER, id: 2 };
    const wide = await renderControls();
    expect(labels(wide)).not.toContain("lightbox.toolbar.moreActions");

    stubs.narrow = true;
    const phone = await renderControls();
    await act(async () => {
      defined(phone.querySelector<HTMLButtonElement>('[aria-label="lightbox.toolbar.moreActions"]')).click();
    });
    expect(phone.querySelector("[data-file-actions]")).toBeNull();
  });

  it("needs no menu on a public page, which has no owner's actions", async () => {
    stubs.narrow = true;
    const container = await renderControls({ isPublic: true });

    expect(labels(container)).not.toContain("lightbox.toolbar.moreActions");
    expect(labels(container)).toContain("lightbox.controls.fullscreen");
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
