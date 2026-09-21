/**
 * Tests for the "Copy to Clipboard" lightbox action (LibrePhotos issue #544):
 * copying a photo from the lightbox used to hand the OS clipboard raw WebP
 * bytes, which most external apps (e.g. Google Docs) can't paste. The button
 * and the "c" keyboard shortcut both route through copyImageToClipboard,
 * which normalizes the image to PNG before writing it to the clipboard.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Photo } from "../../api_client/photos/types";
import i18n from "../../i18n";
import type { LightboxControlsProps } from "./lightbox.types";
import { LightboxControls } from "./LightboxControls";

const stubs = vi.hoisted(() => ({
  copyImageToClipboard: vi.fn(),
  copyImageToClipboardSucceeded: vi.fn(),
  copyImageToClipboardFailed: vi.fn(),
}));

vi.mock("../../api_client/apiClient", () => ({
  serverAddress: "https://photos.example.com",
  shareAddress: "https://share.example.com",
}));

vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { favorite_min_rating: 3 } }),
}));

vi.mock("../../api_client/photos/hooks", () => ({
  useMarkPhotosDeletedMutation: () => ({ mutate: vi.fn() }),
  useSetFavoritePhotosMutation: () => ({ mutate: vi.fn() }),
  useSetPhotosHiddenMutation: () => ({ mutate: vi.fn() }),
  useSetPhotosPublicMutation: () => ({ mutate: vi.fn() }),
}));

vi.mock("../../service/notifications/photos", () => ({
  photos: {
    copyImageToClipboardSucceeded: stubs.copyImageToClipboardSucceeded,
    copyImageToClipboardFailed: stubs.copyImageToClipboardFailed,
  },
}));

vi.mock("../../util/util", async () => {
  const actual = await vi.importActual<typeof import("../../util/util")>("../../util/util");
  return { ...actual, copyImageToClipboard: stubs.copyImageToClipboard };
});

const photoDetail = {
  image_hash: "abc123",
  rating: 0,
  hidden: false,
  public: false,
} as unknown as Photo;

const baseProps: LightboxControlsProps = {
  photoDetail,
  isPhotoDetailsLoading: false,
  lightboxSidebarShow: false,
  setLightBoxSidebarShow: () => {},
  isPublic: false,
  enableZoom: true,
  type: "photo",
  isZoomed: false,
  toggleZoom: () => {},
  onCloseRequest: () => {},
  onRotate: () => {},
  playing: false,
  setPlaying: () => {},
  isFullscreen: false,
  toggleFullscreen: () => {},
  isSlideshowActive: false,
  toggleSlideshow: () => {},
  slideshowInterval: 5,
  setSlideshowInterval: () => {},
  slideshowProgress: 0,
  hasOcrText: false,
  showOcrText: false,
  toggleOcrText: () => {},
};

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.copyImageToClipboard.mockReset();
  stubs.copyImageToClipboardSucceeded.mockReset();
  stubs.copyImageToClipboardFailed.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function renderControls(props: Partial<LightboxControlsProps> = {}) {
  await act(async () => {
    root.render(
      <MantineProvider>
        <LightboxControls {...baseProps} {...props} />
      </MantineProvider>
    );
  });
}

function copyButton() {
  return container.querySelector('button[aria-label="Copy to clipboard (C)"]') as HTMLButtonElement | null;
}

describe("copy to clipboard", () => {
  it("copies the displayed (thumbnails_big) image and shows a success toast", async () => {
    stubs.copyImageToClipboard.mockResolvedValue(undefined);
    await renderControls();

    const button = copyButton();
    expect(button).not.toBeNull();

    await act(async () => {
      button!.click();
    });

    expect(stubs.copyImageToClipboard).toHaveBeenCalledWith("https://photos.example.com/media/thumbnails_big/abc123");
    expect(stubs.copyImageToClipboardSucceeded).toHaveBeenCalledTimes(1);
    expect(stubs.copyImageToClipboardFailed).not.toHaveBeenCalled();
  });

  it("shows an error toast when the clipboard write fails", async () => {
    stubs.copyImageToClipboard.mockRejectedValue(new Error("clipboard denied"));
    await renderControls();

    await act(async () => {
      copyButton()!.click();
    });
    // let the rejected promise's .catch() handler run
    await act(async () => {
      await Promise.resolve();
    });

    expect(stubs.copyImageToClipboardFailed).toHaveBeenCalledTimes(1);
    expect(stubs.copyImageToClipboardSucceeded).not.toHaveBeenCalled();
  });

  it("is available on public/shared lightbox pages too", async () => {
    stubs.copyImageToClipboard.mockResolvedValue(undefined);
    await renderControls({ isPublic: true });

    expect(copyButton()).not.toBeNull();
  });

  it("is not shown for videos", async () => {
    await renderControls({ type: "video" });

    expect(copyButton()).toBeNull();
  });

  it("responds to the lightbox-copy-to-clipboard-shortcut event dispatched for the 'c' key", async () => {
    stubs.copyImageToClipboard.mockResolvedValue(undefined);
    await renderControls();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("lightbox-copy-to-clipboard-shortcut"));
    });

    expect(stubs.copyImageToClipboard).toHaveBeenCalledWith("https://photos.example.com/media/thumbnails_big/abc123");
  });
});
