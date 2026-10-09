/**
 * The lightbox toolbar: every button is named (a tooltip is no accessible
 * name), the trash button restores a photo that is already in the trash
 * instead of trashing it again, and a phone gets one row with the owner's
 * actions in a menu.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LightboxControlsProps } from "./lightbox.types";
import { LightboxControls } from "./LightboxControls";

const stubs = vi.hoisted(() => ({
  markDeleted: vi.fn(),
  narrow: false,
}));

vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoSharesQuery: () => ({ data: [] }),
  useMarkPhotosDeletedMutation: () => ({ mutate: stubs.markDeleted }),
  useSetFavoritePhotosMutation: () => ({ mutate: () => {} }),
  useSetPhotosHiddenMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { favorite_min_rating: 4 } }),
}));
vi.mock("../sharing/PhotoShareLinkModal", () => ({ PhotoShareLinkModal: () => null }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has neither; the interval picker's dropdown uses both.
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = (query: string) =>
    ({
      matches: stubs.narrow && query.includes("max-width"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
});

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  stubs.markDeleted.mockClear();
  stubs.narrow = false;
});

const photo = { id: "p1", image_hash: "h1", hidden: false, rating: 0, in_trashcan: false };

async function renderControls(props: Partial<LightboxControlsProps> & { photo?: object } = {}) {
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
        <LightboxControls
          photoDetail={{ ...photo, ...photoOverride } as unknown as LightboxControlsProps["photoDetail"]}
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
        "lightbox.toolbar.deletePhoto",
        "lightbox.toolbar.showInfoPanel",
        "lightbox.controls.close",
      ])
    );
  });

  it("moves a photo to the trash and then lets the viewer move on", async () => {
    const onAfterTrashToggle = vi.fn();
    const container = await renderControls({ onAfterTrashToggle });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="lightbox.toolbar.deletePhoto"]')!.click();
    });

    expect(stubs.markDeleted).toHaveBeenCalledWith({ image_hashes: ["h1"], deleted: true }, expect.anything());
    stubs.markDeleted.mock.calls[0][1].onSuccess();
    expect(onAfterTrashToggle).toHaveBeenCalledTimes(1);
  });

  it("restores a photo that is already in the trash, by button and by D", async () => {
    const container = await renderControls({ photo: { in_trashcan: true } });

    expect(container.querySelector('[aria-label="lightbox.toolbar.deletePhoto"]')).toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="lightbox.toolbar.restorePhoto"]')!.click();
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("lightbox-delete-shortcut"));
    });

    expect(stubs.markDeleted).toHaveBeenCalledTimes(2);
    stubs.markDeleted.mock.calls.forEach(([request]) =>
      expect(request).toEqual({ image_hashes: ["h1"], deleted: false })
    );
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
    const button = (label: string) => container.querySelector(`[aria-label="${label}"]`)!;

    expect(button("lightbox.toolbar.removeFromFavorites").hasAttribute("aria-pressed")).toBe(false);
    expect(button("lightbox.toolbar.hideInfoPanel").hasAttribute("aria-pressed")).toBe(false);
    expect(button("lightbox.controls.slideshow").hasAttribute("aria-pressed")).toBe(false);
    expect(button("lightbox.controls.zoom").getAttribute("aria-pressed")).toBe("true");
  });

  it("hands focus back to the lightbox once a slideshow interval is picked", async () => {
    const setSlideshowInterval = vi.fn();
    const container = await renderControls({ isSlideshowActive: true, setSlideshowInterval });
    const input = container.querySelector<HTMLInputElement>("input:not([type=hidden])")!;

    await act(async () => {
      input.focus();
      input.click();
    });
    const option = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find(o => o.textContent === "10s")!;
    await act(async () => option.click());

    expect(setSlideshowInterval).toHaveBeenCalledWith(10);
    // Escape and the other shortcuts skip a focused input.
    expect(document.activeElement).toBe(container);
  });

  it("needs no menu on a public page, which has no owner's actions", async () => {
    stubs.narrow = true;
    const container = await renderControls({ isPublic: true });

    expect(labels(container)).not.toContain("lightbox.toolbar.moreActions");
    expect(labels(container)).toContain("lightbox.controls.fullscreen");
  });
});
