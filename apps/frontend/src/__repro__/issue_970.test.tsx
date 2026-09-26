/**
 * Repro for https://github.com/LibrePhotos/librephotos/issues/970
 * "Video previews hangs when listing a huge amount of videos"
 *
 * For a video, the backend stores *animated* square thumbnails: a 5 second
 * H.264 clip at `media/square_thumbnails/<hash>` (500p) and
 * `media/square_thumbnails_small/<hash>` (250p) -- see
 * `api/models/thumbnail.py::_generate_thumbnail` /
 * `api/thumbnails.py::create_animated_thumbnail`. Only `thumbnails_big` is a
 * still image for a video.
 *
 * The grid tile rendered an `<img>` (the low quality image placeholder, and the
 * "video failed" fallback) pointed at those same animated-thumbnail URLs. An
 * `<img>` can never decode an mp4, but the browser still downloads the whole
 * file before firing `onerror`. So every video tile on screen pulled down a
 * complete video clip that renders nothing, on top of the `<video>` element
 * next to it. Scroll a library of 100+ videos and those doomed downloads
 * saturate the browser connection pool, which is what stalls the page while a
 * selection is being made.
 *
 * The `<video>` elements had no `preload` hint either, so a browser that
 * defaults to `preload="auto"` fetched every clip in full, and nothing released
 * the media element when a tile scrolled out of the buffer and unmounted.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Tile from "../components/react-pig/components/Tile/Tile";

const SERVER = "http://localhost:3000";

// The same mapping PhotoListView hands to react-pig.
function getUrl(url: string, pxHeight: number) {
  if (pxHeight < 250) {
    return `${SERVER}/media/square_thumbnails_small/${url.split(";")[0]}`;
  }
  return `${SERVER}/media/square_thumbnails/${url.split(";")[0]}`;
}

const settings = {
  gridGap: 8,
  bgColor: "#fff",
  thumbnailSize: 20,
  expandedSize: 1000,
};

function videoItem(index: number) {
  const hash = `videohash${index}`;
  return {
    id: hash,
    url: hash,
    type: "video",
    aspectRatio: 1.5,
    dominantColor: "#123456",
    isTemp: false,
    style: { width: 200, height: 133, translateX: 0, translateY: index * 133 },
  };
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

function tileElements(count: number, scrollSpeed: string, activeTileUrl: string | null = null) {
  return Array.from({ length: count }, (_, i) => videoItem(i)).map(item => (
    <Tile
      key={item.id}
      item={item}
      useLqip
      containerWidth={1200}
      containerOffsetTop={0}
      getUrl={getUrl}
      activeTileUrl={activeTileUrl}
      handleClick={() => {}}
      handleSelection={() => {}}
      selected={false}
      selectable={false}
      windowHeight={900}
      scrollSpeed={scrollSpeed}
      settings={settings}
    />
  ));
}

function renderTiles(count: number, scrollSpeed = "slow", activeTileUrl: string | null = null) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<>{tileElements(count, scrollSpeed, activeTileUrl)}</>);
  });
  return container;
}

function rerenderTiles(count: number, scrollSpeed: string, activeTileUrl: string | null = null) {
  act(() => {
    root!.render(<>{tileElements(count, scrollSpeed, activeTileUrl)}</>);
  });
}

// jsdom implements neither, and releasing a video calls both.
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  if (root && container) {
    act(() => root!.unmount());
    container.remove();
  }
  root = null;
  container = null;
  vi.restoreAllMocks();
});

function expectReleased(video: HTMLVideoElement) {
  expect(video.pause).toHaveBeenCalled();
  expect(video.getAttribute("src")).toBeNull();
  expect(video.load).toHaveBeenCalled();
}

describe("issue 970: listing a huge amount of videos", () => {
  it("does not request an animated (mp4) thumbnail through an <img> element", () => {
    const grid = renderTiles(120);

    const imageSources = Array.from(grid.querySelectorAll("img")).map(img => img.getAttribute("src") ?? "");
    const animatedThroughImg = imageSources.filter(src => src.includes("/media/square_thumbnails"));

    expect(animatedThroughImg).toEqual([]);
  });

  it("tells the browser not to preload whole video clips", () => {
    const grid = renderTiles(120);

    const videos = Array.from(grid.querySelectorAll("video"));
    expect(videos).toHaveLength(120);
    expect(videos.every(video => video.getAttribute("preload") === "metadata")).toBe(true);
  });

  it("releases the media element when a tile scrolls out of the buffer", () => {
    const video = renderTiles(1).querySelector("video")!;

    act(() => root!.unmount());
    root = null;

    expectReleased(video);
  });

  it("releases the media element when scrolling gets too fast to render previews", () => {
    const video = renderTiles(1).querySelector("video")!;

    // The tile stays mounted, only the <video> inside it goes away.
    rerenderTiles(1, "fast");

    expect(container!.querySelector("video")).toBeNull();
    expectReleased(video);
  });

  it("releases the media element when the expanded tile is dismissed", () => {
    const expandedUrl = videoItem(0).url;
    const video = renderTiles(1, "fast", expandedUrl).querySelector("video")!;

    rerenderTiles(1, "fast");

    expect(container!.querySelector("video")).toBeNull();
    expectReleased(video);
  });
});
