/**
 * #2026: a still poster for videos, and the clip mounted only on hover.
 *
 * After #970 every video tile on screen still mounted a `<video preload="metadata">`, one media
 * player per tile. A video with a poster (`video_poster`) now shows a WebP still, and its clip is
 * mounted only after the pointer has rested on the tile for a moment, or while the tile has keyboard
 * focus, and released again when it leaves. Touch and `prefers-reduced-motion` never preview.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../../../util/defined.test-utils";
import type { ScrollSpeed } from "../../types";
import Tile from "./Tile";
import { PREVIEW_DELAY_MS } from "./useClipPreview";

const settings = { gridGap: 8, bgColor: "#fff", thumbnailSize: 20, expandedSize: 1000 };

function getUrl(imageHash: string, size: number, poster = false) {
  return `/media/${imageHash}?h=${size}${poster ? "&poster" : ""}`;
}

type VideoItem = ReturnType<typeof videoItem>;

function videoItem(overrides: { video_poster?: boolean; animated_preview?: boolean } = {}) {
  return {
    id: "video-1",
    image_hash: "hash1",
    type: "video",
    aspectRatio: 1.5,
    isTemp: false,
    video_poster: true,
    style: { width: 200, height: 133, translateX: 0, translateY: 0 },
    ...overrides,
  };
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let reducedMotion = false;

function tile(item: VideoItem, scrollSpeed: ScrollSpeed, activeTileId: string | null) {
  return (
    <Tile
      item={item}
      useLqip
      containerWidth={1200}
      containerOffsetTop={0}
      getUrl={getUrl}
      activeTileId={activeTileId}
      handleClick={() => {}}
      handleSelection={() => {}}
      selected={false}
      selectable
      windowHeight={900}
      scrollSpeed={scrollSpeed}
      settings={settings}
    />
  );
}

function renderTile(item = videoItem(), scrollSpeed: ScrollSpeed = "slow", activeTileId: string | null = null) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => defined(root).render(tile(item, scrollSpeed, activeTileId)));
  const button = defined(container.querySelector("button"));
  return { button, wrapper: defined(button.parentElement) };
}

function rerender(item: VideoItem, scrollSpeed: ScrollSpeed) {
  act(() => defined(root).render(tile(item, scrollSpeed, null)));
}

// React derives onPointerEnter/onPointerLeave from pointerover/pointerout.
function pointer(element: Element, type: "pointerover" | "pointerout", pointerType = "mouse") {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget: null });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  act(() => {
    element.dispatchEvent(event);
  });
}

function rest(ms = PREVIEW_DELAY_MS) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function sources(element: Element, selector: string) {
  return Array.from(element.querySelectorAll(selector)).map(found => found.getAttribute("src"));
}

function keyboardFocus(visible: boolean) {
  vi.spyOn(Element.prototype, "matches").mockImplementation(selector => visible && selector === ":focus-visible");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  reducedMotion = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("reduce") && reducedMotion,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }))
  );
});

afterEach(() => {
  if (root && container) {
    act(() => defined(root).unmount());
    container.remove();
  }
  root = null;
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("issue 2026: a still poster, and the clip only on hover", () => {
  it("shows the poster and mounts no player at rest", () => {
    const { button } = renderTile();

    expect(button.querySelector("video")).toBeNull();
    expect(sources(button, "img")).toEqual(["/media/hash1?h=20&poster", "/media/hash1?h=400&poster"]);
  });

  it("mounts the clip over the poster once the pointer has rested, and releases it on leave", () => {
    const { button, wrapper } = renderTile();

    pointer(wrapper, "pointerover");
    expect(button.querySelector("video")).toBeNull();
    rest();

    const video = defined(button.querySelector("video"));
    expect(video.getAttribute("src")).toBe("/media/hash1?h=400");
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(sources(button, "img")).toContain("/media/hash1?h=400&poster");
    expect(video.className).not.toMatch(/previewClipPlaying/);

    act(() => {
      video.dispatchEvent(new Event("canplay"));
    });
    expect(video.className).toMatch(/previewClipPlaying/);

    pointer(wrapper, "pointerout");
    expect(button.querySelector("video")).toBeNull();
    expect(video.pause).toHaveBeenCalled();
    expect(video.getAttribute("src")).toBeNull();
  });

  it("loads nothing when the pointer only passes over the tile", () => {
    const { button, wrapper } = renderTile();

    pointer(wrapper, "pointerover");
    rest(PREVIEW_DELAY_MS - 50);
    pointer(wrapper, "pointerout");
    rest();

    expect(button.querySelector("video")).toBeNull();
  });

  it("previews on keyboard focus and stops when focus leaves the tile", () => {
    const { button } = renderTile();
    keyboardFocus(true);

    act(() => button.focus());
    rest();
    expect(button.querySelector("video")).not.toBeNull();

    act(() => button.blur());
    expect(button.querySelector("video")).toBeNull();
  });

  it("keeps previewing while focus moves to the tile's checkbox", () => {
    const { button, wrapper } = renderTile();
    keyboardFocus(true);

    act(() => button.focus());
    rest();
    act(() => defined(wrapper.querySelector("input")).focus());

    expect(button.querySelector("video")).not.toBeNull();
  });

  it("does not preview on the focus a tap gives the button", () => {
    const { button } = renderTile();
    keyboardFocus(false);

    act(() => button.focus());
    rest();

    expect(button.querySelector("video")).toBeNull();
  });

  it("does not preview on touch", () => {
    const { button, wrapper } = renderTile();

    pointer(wrapper, "pointerover", "touch");
    rest();

    expect(button.querySelector("video")).toBeNull();
  });

  it("does not preview with reduced motion", () => {
    reducedMotion = true;
    const { button, wrapper } = renderTile();

    pointer(wrapper, "pointerover");
    rest();

    expect(button.querySelector("video")).toBeNull();
  });

  it("releases the clip when scrolling gets fast", () => {
    const { button, wrapper } = renderTile();
    pointer(wrapper, "pointerover");
    rest();
    const video = defined(button.querySelector("video"));

    rerender(videoItem(), "fast");

    expect(button.querySelector("video")).toBeNull();
    expect(video.getAttribute("src")).toBeNull();
  });

  it("keeps the poster and stops trying when the clip fails", () => {
    const { button, wrapper } = renderTile();
    pointer(wrapper, "pointerover");
    rest();
    act(() => {
      defined(button.querySelector("video")).dispatchEvent(new Event("error"));
    });
    pointer(wrapper, "pointerout");
    pointer(wrapper, "pointerover");
    rest();

    expect(button.querySelector("video")).toBeNull();
    expect(sources(button, "img")).toContain("/media/hash1?h=400&poster");
  });

  it("plays the full size clip in an expanded tile", () => {
    const { button } = renderTile(videoItem(), "slow", "video-1");

    expect(sources(button, "video")).toEqual(["/media/hash1?h=1000"]);
  });

  it("falls back to the clip for a video without a poster yet", () => {
    const { button, wrapper } = renderTile(videoItem({ video_poster: false }));

    expect(sources(button, "video")).toEqual(["/media/hash1?h=400"]);
    expect(button.querySelector("img")).toBeNull();
    pointer(wrapper, "pointerover");
    rest();
    expect(button.querySelectorAll("video")).toHaveLength(1);
  });

  it("shows a still square, not a poster, with the animated previews off", () => {
    const { button, wrapper } = renderTile(videoItem({ animated_preview: false }));

    pointer(wrapper, "pointerover");
    rest();

    expect(button.querySelector("video")).toBeNull();
    expect(sources(button, "img")).toEqual(["/media/hash1?h=20", "/media/hash1?h=400"]);
  });
});
