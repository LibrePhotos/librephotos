/**
 * Zooming into a photo swaps the big thumbnail for the original (#2742): only
 * once the user zooms, only for a format the browser draws that is bigger
 * than the thumbnail, never on a public page, and the face boxes stay in the
 * thumbnail's pixels.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import type { FaceLocationType } from "./lightbox.types";
import { MediaDisplay, type MediaDisplayDetails } from "./MediaDisplay";

vi.mock("./VideoPlayer", () => ({ VideoPlayer: () => null }));
vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));

/** Stands in for `new Image()`: records each preload and lets the test finish it. */
class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  src = "";
  constructor() {
    FakeImage.instances.push(this);
  }
  removeAttribute() {
    this.src = "";
  }
  finish(width: number, height: number) {
    this.naturalWidth = width;
    this.naturalHeight = height;
    this.onload?.();
  }
}

const THUMBNAIL = "/media/thumbnails_big/abc";
const ORIGINAL = "/media/photos/abc";
const JPEG: MediaDisplayDetails = { original_mime_type: "image/jpeg", width: 6000, height: 4000, local_orientation: 1 };

type Options = {
  scale?: number;
  photoDetails?: MediaDisplayDetails;
  isPublic?: boolean;
  faceLocation?: FaceLocationType;
  imageCacheKey?: number;
};

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
});

beforeEach(() => {
  FakeImage.instances = [];
  vi.stubGlobal("Image", FakeImage);
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function render({
  scale = 1,
  photoDetails = JPEG,
  isPublic = false,
  faceLocation = null,
  imageCacheKey = 0,
}: Options) {
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <MediaDisplay
          id="abc"
          image_hash="abc"
          isMainContent
          type="photo"
          faceLocation={faceLocation}
          handleDragStart={() => {}}
          photoDetails={photoDetails}
          isPublic={isPublic}
          scale={scale}
          imageCacheKey={imageCacheKey}
        />
      </MantineProvider>
    );
  });
}

function photo(): HTMLImageElement {
  return defined(container.querySelector("img"));
}

/** The <img> finished loading what it shows, at this natural size. */
async function imgLoaded(width: number, height: number) {
  const img = photo();
  Object.defineProperty(img, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: height, configurable: true });
  await act(async () => {
    img.dispatchEvent(new Event("load"));
  });
}

function chipText(): string | null {
  return container.querySelector('[role="status"]')?.textContent ?? null;
}

describe("MediaDisplay loads the original when zoomed", () => {
  it("asks for nothing but the thumbnail until the user zooms", async () => {
    await render({ scale: 1 });
    await imgLoaded(1620, 1080);

    expect(FakeImage.instances).toHaveLength(0);
    expect(photo().getAttribute("src")).toBe(THUMBNAIL);
    expect(chipText()).toBeNull();
  });

  it("loads the original once on zoom, keeps the thumbnail until it is in, then swaps", async () => {
    await render({ scale: 1 });
    await imgLoaded(1620, 1080);

    await render({ scale: 2 });
    expect(FakeImage.instances).toHaveLength(1);
    const preload = defined(FakeImage.instances[0]);
    expect(preload.src).toBe(ORIGINAL);
    expect(photo().getAttribute("src")).toBe(THUMBNAIL);
    expect(chipText()).toBe("lightbox.original.loading");

    await act(async () => preload.finish(6000, 4000));
    expect(photo().getAttribute("src")).toBe(ORIGINAL);
    expect(chipText()).toBe("lightbox.original.shownsize");

    // Zooming out and in again keeps the original and loads nothing more.
    await render({ scale: 1 });
    expect(chipText()).toBeNull();
    await render({ scale: 3 });
    expect(FakeImage.instances).toHaveLength(1);
    expect(photo().getAttribute("src")).toBe(ORIGINAL);
  });

  it("keeps the face box in the thumbnail's pixels after the swap", async () => {
    const faceLocation = { top: 108, bottom: 216, left: 162, right: 324 };
    await render({ scale: 1, faceLocation });
    await imgLoaded(1620, 1080);
    await render({ scale: 2, faceLocation });
    await act(async () => defined(FakeImage.instances[0]).finish(6000, 4000));
    await imgLoaded(6000, 4000);

    const box = defined(container.querySelector<HTMLElement>("img ~ div"));
    expect(box.style.left).toBe("10%");
    expect(box.style.top).toBe("10%");
    expect(box.style.width).toBe("10%");
  });

  it("offers Try again when the original fails, and loads it again", async () => {
    await render({ scale: 2 });
    await act(async () => defined(FakeImage.instances[0]).onerror?.());

    expect(chipText()).toContain("lightbox.original.failed");
    expect(photo().getAttribute("src")).toBe(THUMBNAIL);

    const retry = defined(
      [...container.querySelectorAll("button")].find(b => b.textContent === "lightbox.original.retry")
    );
    await act(async () => retry.click());
    expect(FakeImage.instances).toHaveLength(2);
    expect(chipText()).toBe("lightbox.original.loading");
  });

  it("keeps the preview of a RAW photo and links its download", async () => {
    await render({ scale: 2, photoDetails: { ...JPEG, original_mime_type: "image/x-dcraw" } });

    expect(FakeImage.instances).toHaveLength(0);
    expect(photo().getAttribute("src")).toBe(THUMBNAIL);
    expect(chipText()).toContain("lightbox.original.reason.raw");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(ORIGINAL);
  });

  it("keeps the preview after a rotation, before the details say so", async () => {
    await render({ scale: 2, imageCacheKey: 42 });

    expect(FakeImage.instances).toHaveLength(0);
    expect(photo().getAttribute("src")).toBe(`${THUMBNAIL}?v=42`);
    expect(chipText()).toContain("lightbox.original.reason.rotated");
  });

  it("loads nothing for a photo no bigger than its thumbnail", async () => {
    await render({ scale: 1, photoDetails: { ...JPEG, width: 1080, height: 720 } });
    await imgLoaded(1080, 720);
    await render({ scale: 2, photoDetails: { ...JPEG, width: 1080, height: 720 } });

    expect(FakeImage.instances).toHaveLength(0);
    expect(chipText()).toBe("lightbox.original.shownsize");
  });

  it("keeps the thumbnail on a public page, without a chip", async () => {
    await render({ scale: 2, isPublic: true });

    expect(FakeImage.instances).toHaveLength(0);
    expect(photo().getAttribute("src")).toBe(THUMBNAIL);
    expect(chipText()).toBeNull();
  });

  it("shows an animated GIF's original from the start, so it animates", async () => {
    await render({ scale: 1, photoDetails: { ...JPEG, original_mime_type: "image/gif" } });

    expect(photo().getAttribute("src")).toBe(ORIGINAL);
    expect(FakeImage.instances).toHaveLength(0);
  });

  it("keeps the thumbnail of a server that does not say what the original is", async () => {
    await render({ scale: 2, photoDetails: { width: 6000, height: 4000 } });

    expect(FakeImage.instances).toHaveLength(0);
    expect(chipText()).toBeNull();
  });
});
