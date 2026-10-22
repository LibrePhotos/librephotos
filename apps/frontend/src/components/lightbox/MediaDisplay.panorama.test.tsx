/**
 * A photo sphere in the 360° view (#483): the viewer takes the place of the flat photo, and draws
 * the original only where zooming may load it too; elsewhere the big thumbnail.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanoramaViewerProps } from "../panorama/PanoramaViewer";
import { MediaDisplay, type MediaDisplayDetails } from "./MediaDisplay";

const viewers = vi.hoisted(() => [] as PanoramaViewerProps[]);

vi.mock("./VideoPlayer", () => ({ VideoPlayer: () => null }));
vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../panorama/LazyPanoramaViewer", () => ({
  LazyPanoramaViewer: (props: PanoramaViewerProps) => {
    viewers.push(props);
    return <div data-testid="panorama" />;
  },
}));

const THUMBNAIL = "/media/thumbnails_big/abc";
const ORIGINAL = "/media/photos/abc";
const SPHERE: MediaDisplayDetails = {
  original_mime_type: "image/jpeg",
  width: 8000,
  height: 4000,
  local_orientation: 1,
  image_path: ["/photos/beach.jpg"],
};

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
  viewers.length = 0;
  container = document.createElement("div");
  root = createRoot(container);
});

type Options = {
  panoramaActive?: boolean;
  photoDetails?: MediaDisplayDetails;
  isPublic?: boolean;
  isMainContent?: boolean;
  onPanoramaError?: () => void;
};

async function render({ panoramaActive = true, photoDetails = SPHERE, isPublic = false, ...rest }: Options = {}) {
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <MediaDisplay
          id="abc"
          image_hash="abc"
          isMainContent={rest.isMainContent ?? true}
          type="photo"
          faceLocation={null}
          handleDragStart={() => {}}
          photoDetails={photoDetails}
          isPublic={isPublic}
          panoramaActive={panoramaActive}
          onPanoramaError={rest.onPanoramaError}
        />
      </MantineProvider>
    );
  });
}

describe("MediaDisplay in the 360° view", () => {
  it("shows the flat photo until the view is on", async () => {
    await render({ panoramaActive: false });

    expect(container.querySelector("img")).not.toBeNull();
    expect(viewers).toHaveLength(0);
  });

  it("draws the owner's original, named like the photo", async () => {
    const onPanoramaError = vi.fn<() => void>();
    await render({ onPanoramaError });

    expect(container.querySelector("img")).toBeNull();
    expect(viewers.at(-1)).toMatchObject({ src: ORIGINAL, label: "beach.jpg" });
    viewers.at(-1)?.onLoadFailed();
    expect(onPanoramaError).toHaveBeenCalledOnce();
  });

  it("draws the big thumbnail on a public page", async () => {
    await render({ isPublic: true });

    expect(viewers.at(-1)?.src).toBe(THUMBNAIL);
  });

  it("draws the big thumbnail of an original the browser cannot draw", async () => {
    await render({ photoDetails: { ...SPHERE, original_mime_type: "image/heic" } });

    expect(viewers.at(-1)?.src).toBe(THUMBNAIL);
  });

  it("leaves the neighbouring slides flat", async () => {
    await render({ isMainContent: false });

    expect(viewers).toHaveLength(0);
  });
});
