/**
 * Repro for https://github.com/LibrePhotos/librephotos/issues/2027
 * "Album cover tiles autoplay and loop every video cover"
 *
 * `components/Tile.tsx` backs the album, people, things and places covers and
 * the cover picker. It rendered a video cover with `autoPlay muted loop`, so
 * every such cover ran a media player for as long as the page was open -- with
 * several of them, that many decoders at once.
 *
 * This is the same class of problem #970 had in the photo *grid* tile
 * (`react-pig/components/Tile/Tile.jsx`, fixed in #2018): no preload hint, and
 * nothing released the media element on unmount.
 */
import { MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Tile } from "../components/Tile";

beforeAll(() => {
  // jsdom implements none of these, and the component calls all three.
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  // MantineProvider reads it on mount; jsdom has no matchMedia.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

function renderCovers(count: number) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <>
        {Array.from({ length: count }, (_, i) => (
          <Tile key={i} video width={200} height={200} image_hash={`videohash${i}`} />
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

describe("issue 2027: album cover tiles autoplay and loop", () => {
  it("does not autoplay a video cover", () => {
    const covers = renderCovers(12);
    const videos = Array.from(covers.querySelectorAll("video"));

    expect(videos).toHaveLength(12);
    expect(videos.some(video => video.hasAttribute("autoplay"))).toBe(false);
    expect(videos.every(video => video.autoplay === false)).toBe(true);
  });

  it("tells the browser not to preload whole video clips", () => {
    const covers = renderCovers(12);
    const videos = Array.from(covers.querySelectorAll("video"));

    expect(videos.every(video => video.getAttribute("preload") === "metadata")).toBe(true);
  });

  it("plays on hover and stops again on leave", () => {
    const covers = renderCovers(1);
    const video = covers.querySelector("video")!;
    const play = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(video, "pause");

    act(() => {
      video.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(play).toHaveBeenCalled();

    act(() => {
      video.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(0);
  });

  it("releases the media element on unmount", () => {
    const covers = renderCovers(1);
    const video = covers.querySelector("video")!;
    const pause = vi.spyOn(video, "pause");
    const load = vi.spyOn(video, "load");

    act(() => root!.unmount());
    root = null;

    expect(pause).toHaveBeenCalled();
    expect(video.getAttribute("src")).toBeNull();
    expect(load).toHaveBeenCalled();
  });

  it("still shows an image for a non-video tile", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      // Mantine's <Image> needs the provider; the video branch does not, which
      // is why only this case is wrapped.
      root!.render(
        <MantineProvider>
          <Tile width={200} height={200} image_hash="stillhash" />
        </MantineProvider>
      );
    });

    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });
});
