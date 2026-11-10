import { Settings } from "luxon";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../../../i18n";
import { defined } from "../../../../util/defined.test-utils";
import type { ImageItem, ScrollSpeed } from "../../types";
import { forgetLoaded } from "../../utils/loadedImages";
import Tile from "./Tile";

// A 100 x 60 gradient's ThumbHash, as the backend stores it.
const SKY_THUMBHASH = "4QYKhJqGh4eAh4iHiHeAdQj4iA==";

type PhotoItem = ReturnType<typeof photoItem> & { thumbhash?: string };

function photoItem(
  overrides: Partial<
    Pick<ImageItem, "type" | "date" | "is_hdr" | "animated_preview" | "video_length" | "projection_type">
  > = {}
) {
  return {
    id: "photo-1",
    image_hash: "hash1",
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
  item: PhotoItem,
  {
    selectable = true,
    handleClick = vi.fn<(event: React.MouseEvent<HTMLButtonElement>, clicked: PhotoItem) => void>(),
    handleSelection = vi.fn<(selected: PhotoItem) => void>(),
    scrollSpeed = "slow" as ScrollSpeed,
  } = {}
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    defined(root).render(
      <Tile
        item={item}
        containerWidth={1200}
        getUrl={(imageHash: string, size: number) => `/media/${imageHash}?h=${size}`}
        handleClick={handleClick}
        handleSelection={handleSelection}
        selected={false}
        selectable={selectable}
        scrollSpeed={scrollSpeed}
      />
    );
  });
  return {
    button: defined(container.querySelector("button")),
    checkbox: container.querySelector<HTMLInputElement>('input[type="checkbox"]'),
    handleClick,
    handleSelection,
  };
}

beforeAll(async () => {
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

afterEach(() => {
  forgetLoaded();
  if (root && container) {
    act(() => defined(root).unmount());
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

  it("reads the capture time as the camera's wall clock, whatever the viewer's zone", () => {
    // exif_timestamp is tagged UTC but means local time where the photo was taken.
    const previousZone = Settings.defaultZone;
    Settings.defaultZone = "America/New_York";
    try {
      expect(renderTile(photoItem()).button.getAttribute("aria-label")).toContain("2:02");
    } finally {
      Settings.defaultZone = previousZone;
    }
  });

  it("falls back to the media type when there is no date", () => {
    expect(renderTile(photoItem({ date: null })).button.getAttribute("aria-label")).toBe("Photo");
  });

  it("names videos as videos and ignores an unparseable date", () => {
    const { button } = renderTile(photoItem({ type: "video", date: "not a date" }));
    expect(button.getAttribute("aria-label")).toBe("Video");
  });

  it("says when a video is HDR: the badge on the tile is hidden from assistive tech", () => {
    expect(renderTile(photoItem({ type: "video", is_hdr: true })).button.getAttribute("aria-label")).toMatch(
      /^HDR video taken /
    );
  });

  it("says how long a video is: the duration on the tile is drawn for sighted users only", () => {
    expect(renderTile(photoItem({ type: "video", video_length: "42.4" })).button.getAttribute("aria-label")).toMatch(
      /^Video taken .*2024.*, 42 seconds$/
    );
  });

  it("leaves an unknown or zero length out of the label, and a photo's", () => {
    for (const item of [
      photoItem({ type: "video", date: null, video_length: "None" }),
      photoItem({ type: "video", date: null, video_length: "0.2" }),
      photoItem({ date: null, video_length: "42" }),
    ]) {
      const { button } = renderTile(item);
      expect(button.getAttribute("aria-label")).toMatch(/^(Video|Photo)$/);
      act(() => defined(root).unmount());
      defined(container).remove();
      root = null;
      container = null;
    }
  });

  it("names an undated HDR video, and leaves SDR videos alone", () => {
    expect(renderTile(photoItem({ type: "video", is_hdr: true, date: null })).button.getAttribute("aria-label")).toBe(
      "HDR video"
    );
    act(() => defined(root).unmount());
    defined(container).remove();
    root = null;
    expect(renderTile(photoItem({ type: "video", is_hdr: false })).button.getAttribute("aria-label")).toMatch(
      /^Video taken /
    );
  });

  it("names a 360° photo sphere, whose badge is hidden from screen readers (#483)", () => {
    expect(
      renderTile(photoItem({ projection_type: "equirectangular", date: null })).button.getAttribute("aria-label")
    ).toBe("360° photo");
    act(() => defined(root).unmount());
    defined(container).remove();
    root = null;
    expect(renderTile(photoItem({ projection_type: "equirectangular" })).button.getAttribute("aria-label")).toMatch(
      /^360° photo taken /
    );
  });

  it("keeps the selection checkbox out of the button and names it", () => {
    const { button, checkbox } = renderTile(photoItem());

    expect(checkbox).not.toBeNull();
    expect(button.contains(checkbox)).toBe(false);
    expect(defined(checkbox).closest("button")).toBeNull();
    expect(defined(checkbox).getAttribute("aria-label")).toBe(`Select ${button.getAttribute("aria-label")}`);
  });

  it("selects through the checkbox without also opening the photo", () => {
    const { checkbox, handleClick, handleSelection } = renderTile(photoItem());

    act(() => defined(checkbox).click());

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
    expect(defined(handleClick.mock.calls[0], "the click call")[0].shiftKey).toBe(true);
    expect(defined(handleClick.mock.calls[0], "the click call")[1]).toEqual(expect.objectContaining({ id: "photo-1" }));
    expect(handleSelection).not.toHaveBeenCalled();
  });

  it("renders no checkbox when the grid is not selectable", () => {
    expect(renderTile(photoItem(), { selectable: false }).checkbox).toBeNull();
  });
});

describe("react-pig Tile media", () => {
  it("builds the grid image's address from the image hash, and asks for no smaller one", () => {
    const { button } = renderTile(photoItem());

    const sources = Array.from(button.querySelectorAll("img")).map(img => img.getAttribute("src"));
    expect(sources).toEqual(["/media/hash1?h=400"]);
  });

  it("shows the photo's ThumbHash under the grid image, without a request of its own", () => {
    const { button } = renderTile({ ...photoItem(), thumbhash: SKY_THUMBHASH });

    const [placeholder, grid] = Array.from(button.querySelectorAll("img"));
    expect(defined(placeholder).getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    // Versioned by the hash, so the browser may keep it.
    expect(defined(grid).getAttribute("src")).toMatch(/^\/media\/hash1\?h=400&v=[0-9a-z]+$/);
  });

  it("keeps the dominant colour for a hash it cannot read", () => {
    const { button } = renderTile({ ...photoItem(), thumbhash: "not base64!" });

    const sources = Array.from(button.querySelectorAll("img")).map(img => img.getAttribute("src") ?? "");
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatch(/^\/media\/hash1\?h=400&v=/);
  });

  it("asks for another address once the thumbnails were built again", () => {
    const src = (thumbhash: string) =>
      Array.from(renderTile({ ...photoItem(), thumbhash }).button.querySelectorAll("img"))
        .map(img => img.getAttribute("src") ?? "")
        .find(address => address.startsWith("/media/"));
    const before = src(SKY_THUMBHASH);
    act(() => defined(root).unmount());
    expect(src("IAgSAwB5lZtfand4AAAAAAA=")).not.toBe(before);
  });

  it("shows a picture it showed before at once when the tile mounts again, without the placeholder", () => {
    const first = renderTile({ ...photoItem(), thumbhash: SKY_THUMBHASH });
    const [, grid] = Array.from(first.button.querySelectorAll("img"));
    act(() => {
      defined(grid).dispatchEvent(new Event("load"));
    });
    act(() => defined(root).unmount());

    const again = renderTile({ ...photoItem(), thumbhash: SKY_THUMBHASH });
    const images = Array.from(again.button.querySelectorAll("img"));
    expect(images.map(img => img.getAttribute("src") ?? "").filter(src => src.startsWith("data:"))).toEqual([]);
    expect(defined(images[0]).className).toMatch(/pigFullLoaded/);
    expect(defined(images[0]).className).toMatch(/pigFullAtOnce/);
  });

  it("keeps a picture it showed before while scrolling fast", () => {
    const first = renderTile(photoItem());
    act(() => {
      defined(first.button.querySelector("img")).dispatchEvent(new Event("load"));
    });
    act(() => defined(root).unmount());

    const fast = renderTile(photoItem(), { scrollSpeed: "fast" });
    expect(Array.from(fast.button.querySelectorAll("img")).map(img => img.getAttribute("src"))).toEqual([
      "/media/hash1?h=400",
    ]);
  });

  it("loads nothing new while scrolling fast", () => {
    const { button } = renderTile({ ...photoItem(), thumbhash: SKY_THUMBHASH }, { scrollSpeed: "fast" });
    expect(Array.from(button.querySelectorAll("img")).map(img => img.getAttribute("src")?.slice(0, 5))).toEqual([
      "data:",
    ]);
  });

  it("fades the grid image in once it has loaded", () => {
    const { button } = renderTile({ ...photoItem(), thumbhash: SKY_THUMBHASH });
    const [, grid] = Array.from(button.querySelectorAll("img"));
    expect(defined(grid).className).not.toMatch(/pigFullLoaded/);

    act(() => {
      defined(grid).dispatchEvent(new Event("load"));
    });

    expect(defined(grid).className).toMatch(/pigFullLoaded/);
  });

  it("sits where the layout put it, at once, and moves at once when the layout changes", () => {
    const item = { ...photoItem(), style: { width: 200, height: 133, translateX: 12.5, translateY: 340 } };
    const { button } = renderTile(item);
    const tile = defined(button.parentElement);

    expect(tile.style.transform).toBe("translate(12.5px, 340px)");
    expect(tile.style.width).toBe("200px");
    expect(tile.style.height).toBe("133px");
    expect(tile.style.backgroundColor).toBe("rgb(18, 52, 86)");

    act(() => {
      defined(root).render(
        <Tile
          item={{ ...item, style: { width: 305.085, height: 203.39, translateX: 0, translateY: 32 } }}
          containerWidth={1200}
          getUrl={(imageHash: string, size: number) => `/media/${imageHash}?h=${size}`}
          handleClick={() => {}}
          handleSelection={() => {}}
          selected={false}
          selectable
          scrollSpeed="slow"
        />
      );
    });

    // The same element, already at its new place: no animation runs between the two layouts.
    expect(button.parentElement).toBe(tile);
    expect(tile.style.transform).toBe("translate(0px, 32px)");
    expect(tile.style.width).toBe("305.085px");
    expect(tile.style.height).toBe("203.39px");
    expect(tile.getAnimations?.() ?? []).toEqual([]);
  });

  it("opens through the grid's click handler and shows no larger copy of itself", () => {
    const { button, handleClick } = renderTile(photoItem({ type: "video" }));

    act(() => button.click());

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(Array.from(button.querySelectorAll("video")).map(video => video.getAttribute("src"))).toEqual([
      "/media/hash1?h=400",
    ]);
  });

  it("shows a video with a still square as an image (#649)", () => {
    const { button } = renderTile(photoItem({ type: "video", animated_preview: false }));

    expect(button.querySelector("video")).toBeNull();
    expect(Array.from(button.querySelectorAll("img")).map(img => img.getAttribute("src"))).toEqual([
      "/media/hash1?h=400",
    ]);
    // The overlay's play icon and the label say it is a video.
    expect(button.getAttribute("aria-label")).toMatch(/^Video taken /);
  });

  it("plays a video whose square is a clip, or whose backend predates the flag", () => {
    for (const animated_preview of [true, undefined]) {
      const { button } = renderTile(photoItem({ type: "video", animated_preview }));
      expect(button.querySelectorAll("video")).toHaveLength(1);
      act(() => defined(root).unmount());
      defined(container).remove();
      root = null;
      container = null;
    }
  });

  it("shows the square as an image when the clip fails to load", () => {
    const { button } = renderTile(photoItem({ type: "video" }));

    act(() => {
      defined(button.querySelector("video")).dispatchEvent(new Event("error"));
    });

    expect(button.querySelector("video")).toBeNull();
    expect(Array.from(button.querySelectorAll("img")).map(img => img.getAttribute("src"))).toContain(
      "/media/hash1?h=400"
    );
  });
});
