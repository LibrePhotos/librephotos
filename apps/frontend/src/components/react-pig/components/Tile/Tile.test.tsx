import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../../../i18n";
import TileJsx from "./Tile";

// Tile.jsx declares its props with PropTypes only, which TypeScript cannot see.
const Tile = TileJsx as React.ComponentType<any>;

const settings = { gridGap: 8, bgColor: "#fff", thumbnailSize: 20, expandedSize: 1000 };

function photoItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "photo-1",
    url: "hash1",
    type: "image",
    date: "2024-03-12T14:02:00Z",
    aspectRatio: 1.5,
    dominantColor: "#123456",
    isTemp: false,
    style: { width: 200, height: 133, translateX: 0, translateY: 0 },
    ...overrides,
  };
}

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

function renderTile(
  item: ReturnType<typeof photoItem>,
  { selectable = true, handleClick = vi.fn(), handleSelection = vi.fn() } = {}
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Tile
        item={item}
        useLqip
        containerWidth={1200}
        containerOffsetTop={0}
        getUrl={(url: string) => `/media/${url}`}
        activeTileUrl={null}
        handleClick={handleClick}
        handleSelection={handleSelection}
        selected={false}
        selectable={selectable}
        windowHeight={900}
        scrollSpeed="slow"
        settings={settings}
      />
    );
  });
  return {
    button: container.querySelector("button")!,
    checkbox: container.querySelector<HTMLInputElement>('input[type="checkbox"]'),
    handleClick,
    handleSelection,
  };
}

beforeAll(async () => {
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

afterEach(() => {
  if (root && container) {
    act(() => root!.unmount());
    container.remove();
  }
  root = null;
  container = null;
});

describe("react-pig Tile accessibility", () => {
  it("names the photo button after the media type and capture date", () => {
    const { button } = renderTile(photoItem());

    const label = button.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/^Photo taken /);
    expect(label).toContain("2024");
    // The images stay decorative; the name comes from the button alone.
    expect(Array.from(button.querySelectorAll("img")).every(img => img.getAttribute("alt") === "")).toBe(true);
  });

  it("falls back to the media type when there is no date", () => {
    expect(renderTile(photoItem({ date: null })).button.getAttribute("aria-label")).toBe("Photo");
  });

  it("names videos as videos and ignores an unparseable date", () => {
    const { button } = renderTile(photoItem({ type: "video", date: "not a date" }));
    expect(button.getAttribute("aria-label")).toBe("Video");
  });

  it("keeps the selection checkbox out of the button and names it", () => {
    const { button, checkbox } = renderTile(photoItem());

    expect(checkbox).not.toBeNull();
    expect(button.contains(checkbox)).toBe(false);
    expect(checkbox!.closest("button")).toBeNull();
    expect(checkbox!.getAttribute("aria-label")).toBe(`Select ${button.getAttribute("aria-label")}`);
  });

  it("selects through the checkbox without also opening the photo", () => {
    const { checkbox, handleClick, handleSelection } = renderTile(photoItem());

    act(() => checkbox!.click());

    expect(handleSelection).toHaveBeenCalledTimes(1);
    expect(handleSelection).toHaveBeenCalledWith(expect.objectContaining({ id: "photo-1" }));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("passes shift-clicks on the photo through for range selection", () => {
    const { button, handleClick, handleSelection } = renderTile(photoItem());

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    });

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick.mock.calls[0][0].shiftKey).toBe(true);
    expect(handleClick.mock.calls[0][1]).toEqual(expect.objectContaining({ id: "photo-1" }));
    expect(handleSelection).not.toHaveBeenCalled();
  });

  it("renders no checkbox when the grid is not selectable", () => {
    expect(renderTile(photoItem(), { selectable: false }).checkbox).toBeNull();
  });
});
