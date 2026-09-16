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
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

// jsdom implements neither, and the unmount cleanup calls both.
beforeAll(() => {
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
});

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

function renderTiles(count: number) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const items = Array.from({ length: count }, (_, i) => videoItem(i));
  act(() => {
    root!.render(
      <>
        {items.map(item => (
          <Tile
            key={item.id}
            item={item}
            useLqip
            containerWidth={1200}
            containerOffsetTop={0}
            getUrl={getUrl}
            activeTileUrl={null}
            handleClick={() => {}}
            handleSelection={() => {}}
            selected={false}
            selectable={false}
            windowHeight={900}
            scrollSpeed="slow"
            settings={settings}
          />
        ))}
      </>
    );
  });
  return container;
}

afterEach(() => {
  if (root && container) {
    act(() => root!.unmount());
    container.remove();
  }
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("issue 970: listing a huge amount of videos", () => {
  it("does not request an animated (mp4) thumbnail through an <img> element", () => {
    const tiles = renderTiles(120);

    const imageSources = Array.from(tiles.querySelectorAll("img")).map(img => img.getAttribute("src") ?? "");
    const animatedThroughImg = imageSources.filter(src => src.includes("/media/square_thumbnails"));

    expect(animatedThroughImg).toEqual([]);
  });

  it("tells the browser not to preload whole video clips", () => {
    const tiles = renderTiles(120);

    const videos = Array.from(tiles.querySelectorAll("video"));
    expect(videos).toHaveLength(120);
    expect(videos.every(video => video.getAttribute("preload") === "metadata")).toBe(true);
  });

  it("releases the media element when a tile scrolls out of the buffer", () => {
    const tiles = renderTiles(1);
    const video = tiles.querySelector("video")!;
    const pause = vi.spyOn(video, "pause");
    const load = vi.spyOn(video, "load");

    act(() => root!.unmount());
    root = null;

    expect(pause).toHaveBeenCalled();
    expect(video.getAttribute("src")).toBeNull();
    expect(load).toHaveBeenCalled();
  });
});
