import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "../../i18n";
import Pig from ".";
import { defined } from "../../util/defined.test-utils";

const groups = [
  {
    date: "2024-03-12",
    location: "Berlin",
    numberOfItems: 1,
    items: [
      { id: "photo-1", image_hash: "hash1", aspectRatio: 1.5, dominantColor: "#123456", date: "2024-03-12T14:02:00Z" },
    ],
  },
];

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

function renderPig(props: { textAlignment: "left" | "right"; headerSize: "large" | "normal" | "small" }) {
  act(() => {
    defined(root).render(
      <Pig imageData={groups} groupByDate getUrl={(imageHash: string) => `/media/${imageHash}`} {...props} />
    );
  });
  return defined(defined(container).querySelector(".pig-header"));
}

beforeAll(() => {
  // jsdom lays nothing out; give the grid a width so it computes a layout.
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1000 });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root && container) {
    act(() => defined(root).unmount());
    container.remove();
  }
  root = null;
  container = null;
});

describe("react-pig date headers", () => {
  it("keeps two groups with the same date label apart", () => {
    // Two UTC days can format to the same local day; React then warned about
    // duplicate keys and could drop or duplicate a group.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const sameDay = (id: string) => ({
      date: "Wednesday, April 3, 2024",
      location: "Tokyo",
      numberOfItems: 1,
      items: [{ id, image_hash: id, aspectRatio: 1.5, dominantColor: "#123456" }],
    });

    act(() => {
      defined(root).render(
        <Pig
          imageData={[sameDay("a"), sameDay("b")]}
          groupByDate
          getUrl={(imageHash: string) => `/media/${imageHash}`}
        />
      );
    });

    expect(container.querySelectorAll(".pig-header")).toHaveLength(2);
    expect(errors.mock.calls.some((call: unknown[]) => String(call[0]).includes("same key"))).toBe(false);
    errors.mockRestore();
  });

  it("keeps a date-album group's identity when an earlier group with the same label leaves", () => {
    // The repeat suffix counts within the rendered window, so the second group
    // took the first one's key once that scrolled out, and its tiles remounted.
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const sameDay = (id: string) => ({
      id,
      date: "Wednesday, April 3, 2024",
      location: "Tokyo",
      numberOfItems: 1,
      items: [{ id: `photo-${id}`, image_hash: id, aspectRatio: 1.5, dominantColor: "#123456" }],
    });
    const render = (data: ReturnType<typeof sameDay>[]) =>
      act(() => {
        defined(root).render(
          <Pig imageData={data} groupByDate getUrl={(imageHash: string) => `/media/${imageHash}`} />
        );
      });

    render([sameDay("g1"), sameDay("g2")]);
    const second = container.querySelectorAll(".pig-header")[1];
    render([sameDay("g2")]);

    expect(container.querySelectorAll(".pig-header")).toHaveLength(1);
    expect(container.querySelector(".pig-header")).toBe(second);
  });

  it("re-render when the text alignment or header size setting changes", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const header = renderPig({ textAlignment: "right", headerSize: "large" });
    expect(header).not.toBeNull();
    expect(defined(header.firstElementChild).className).toContain("pig-header_location");

    const realigned = renderPig({ textAlignment: "left", headerSize: "large" });
    expect(defined(realigned.firstElementChild).className).toContain("pig-header_date");

    const before = renderPig({ textAlignment: "left", headerSize: "large" }).className;
    const resized = renderPig({ textAlignment: "left", headerSize: "small" }).className;
    expect(resized).not.toBe(before);
  });
});

describe("react-pig photo size", () => {
  it("lays the grid out at the size it was just given", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const tiles = [{ id: "photo-1", image_hash: "hash1", aspectRatio: 1.5, dominantColor: "#123456" }];
    const tileWidth = (scaleOfImages: number) => {
      act(() => {
        defined(root).render(
          <Pig imageData={tiles} scaleOfImages={scaleOfImages} getUrl={(imageHash: string) => `/media/${imageHash}`} />
        );
      });
      return Number(defined(container).querySelector("img")?.getAttribute("width"));
    };

    // 1000px wide: a row needs an aspect ratio of 3 at scale 1, of 6 at scale 2
    expect(tileWidth(1)).toBeCloseTo(500);
    expect(tileWidth(2)).toBeCloseTo(250);
  });
});

describe("react-pig expanded tile", () => {
  // Two tiles fill a 1000px row at 500px each, so neither is already full width.
  // Their ids and hashes differ: the expanded tile is tracked by id.
  const tile = (id: string, extra: { type?: string; isTemp?: boolean } = {}) => ({
    id: `photo-${id}`,
    image_hash: `hash-${id}`,
    aspectRatio: 1.5,
    dominantColor: "#123456",
    ...extra,
  });

  function renderGrid(tiles: ReturnType<typeof tile>[]) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      defined(root).render(<Pig imageData={tiles} getUrl={(imageHash, size) => `/media/${imageHash}?h=${size}`} />);
    });
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button.pig-btn"));
    const expandedSources = () =>
      Array.from(defined(container).querySelectorAll<HTMLImageElement | HTMLVideoElement>("img, video"))
        .map(media => media.getAttribute("src") ?? "")
        .filter(src => src.endsWith("?h=1000"));
    return { buttons, expandedSources };
  }

  beforeAll(() => {
    HTMLMediaElement.prototype.pause = () => {};
    HTMLMediaElement.prototype.load = () => {};
  });

  it("expands a clicked video in place, moves to another tile, and collapses on a second click", () => {
    const { buttons, expandedSources } = renderGrid([tile("a", { type: "video" }), tile("b", { type: "video" })]);
    expect(buttons).toHaveLength(2);
    expect(expandedSources()).toEqual([]);

    act(() => defined(buttons[0]).click());
    expect(expandedSources()).toEqual(["/media/hash-a?h=1000"]);

    act(() => defined(buttons[1]).click());
    expect(expandedSources()).toEqual(["/media/hash-b?h=1000"]);

    act(() => defined(buttons[1]).click());
    expect(expandedSources()).toEqual([]);
  });

  it("lowers the date header under an expanded tile, but never expands a placeholder", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const group = { date: "2024-03-12", location: null, items: [tile("a", { isTemp: true }), tile("b")] };
    act(() => {
      defined(root).render(<Pig imageData={[group]} groupByDate getUrl={imageHash => `/media/${imageHash}`} />);
    });
    const header = defined(container.querySelector<HTMLElement>(".pig-header"));
    const [placeholder, photo] = Array.from(container.querySelectorAll<HTMLButtonElement>("button.pig-btn"));
    expect(header.style.zIndex).toBe("2");

    act(() => defined(placeholder).click());
    expect(header.style.zIndex).toBe("2");

    act(() => defined(photo).click());
    expect(header.style.zIndex).toBe("1");
  });
});
