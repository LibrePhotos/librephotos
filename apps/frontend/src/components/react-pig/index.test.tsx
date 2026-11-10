import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("shows a group's note beside its date, on either side (#2751)", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const noted = [{ ...defined(groups[0]), note: "Age 6" }];
    const render = (textAlignment: "left" | "right") => {
      act(() => {
        defined(root).render(
          <Pig
            imageData={noted}
            groupByDate
            getUrl={(imageHash: string) => `/media/${imageHash}`}
            textAlignment={textAlignment}
          />
        );
      });
      const header = defined(defined(container).querySelector(".pig-header"));
      return Array.from(header.children).map(child => child.className.split(" ").find(name => name.startsWith("pig-")));
    };

    expect(render("left")).toEqual(["pig-header_date", "pig-header_note", "pig-header_location"]);
    expect(render("right")).toEqual(["pig-header_location", "pig-header_note", "pig-header_date"]);
    expect(defined(container).querySelector(".pig-header_note")?.textContent).toBe("Age 6");
  });

  it("has no note without one", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    renderPig({ textAlignment: "left", headerSize: "large" });

    expect(defined(container).querySelector(".pig-header_note")).toBeNull();
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

    // 1000px wide: a row needs an aspect ratio of 5.9 at scale 1 (169px tall), of 11.8 at scale 2
    expect(tileWidth(1)).toBeCloseTo(254.24);
    expect(tileWidth(2)).toBeCloseTo(127.12);
  });
});

describe("react-pig tile clicks", () => {
  // Two tiles fill a 1000px row at 500px each. A click is the caller's (PhotoListView opens the
  // lightbox); the grid itself no longer expands a tile in place.
  const tile = (id: string) => ({
    id: `photo-${id}`,
    image_hash: `hash-${id}`,
    aspectRatio: 1.5,
    dominantColor: "#123456",
    type: "video",
  });

  beforeAll(() => {
    HTMLMediaElement.prototype.pause = () => {};
    HTMLMediaElement.prototype.load = () => {};
  });

  it("hands a click to the caller and leaves the grid as it was", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const handleClick = vi.fn<(event: React.MouseEvent, item: ReturnType<typeof tile>) => void>();
    act(() => {
      defined(root).render(
        <Pig
          imageData={[tile("a"), tile("b")]}
          handleClick={handleClick}
          getUrl={(imageHash, size) => `/media/${imageHash}?h=${size}`}
        />
      );
    });
    const sources = () =>
      Array.from(defined(container).querySelectorAll("img, video")).map(media => media.getAttribute("src"));
    const before = sources();
    const [first] = Array.from(container.querySelectorAll<HTMLButtonElement>("button.pig-btn"));

    act(() => defined(first).click());

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick.mock.calls[0]?.[1]).toMatchObject({ id: "photo-a" });
    expect(sources()).toEqual(before);
  });

  it("ignores a click without a handler", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      defined(root).render(<Pig imageData={[tile("a"), tile("b")]} getUrl={imageHash => `/media/${imageHash}`} />);
    });
    const tiles = () => Array.from(defined(container).querySelectorAll<HTMLElement>("button.pig-btn"));
    const places = () => tiles().map(button => defined(button.parentElement).getAttribute("style"));
    const before = places();

    act(() => defined(tiles()[0]).click());

    expect(places()).toEqual(before);
  });
});

describe("react-pig container width", () => {
  // Captures the observers Pig creates, so a test can report a resize of the grid's own element
  // (a sidebar, a side panel or a scrollbar taking width) with no window resize event.
  const observers: { callback: ResizeObserverCallback; observer: ResizeObserver }[] = [];
  let width = 1000;

  beforeEach(() => {
    observers.length = 0;
    width = 1000;
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => width });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push({ callback, observer: this });
        }
        observe() {}
        unobserve() {}
        disconnect() {
          const index = observers.findIndex(entry => entry.observer === this);
          if (index >= 0) observers.splice(index, 1);
        }
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1000 });
  });

  const nextFrame = () => new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));

  async function resizeContainer(next: number) {
    width = next;
    await act(async () => {
      // Pig reads the width from the element, not from the entries.
      for (const { callback, observer } of [...observers]) callback([], observer);
      await nextFrame();
    });
  }

  function renderTiles() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const tiles = ["a", "b"].map(id => ({ id, image_hash: id, aspectRatio: 1.5, dominantColor: "#123456" }));
    act(() => {
      defined(root).render(<Pig imageData={tiles} getUrl={(imageHash: string) => `/media/${imageHash}`} />);
    });
    return () => Array.from(defined(container).querySelectorAll("img")).map(img => Number(img.getAttribute("width")));
  }

  it("lays the grid out again when its container narrows without a window resize", async () => {
    const tileWidths = renderTiles();
    // Two 1.5 tiles do not fill a row (above 800px wide it needs an aspect ratio of 5.9), so the
    // row is (width - the 4px gap) / 5.9 tall.
    expect(tileWidths()[0]).toBeCloseTo(253.22);

    await resizeContainer(900);

    expect(tileWidths()[0]).toBeCloseTo(227.8);
  });

  it("keeps the layout while the container is hidden (0px wide) and stops observing on unmount", async () => {
    const tileWidths = renderTiles();

    await resizeContainer(0);
    expect(tileWidths()[0]).toBeCloseTo(253.22);

    act(() => defined(root).unmount());
    root = null;
    defined(container).remove();
    container = null;
    expect(observers).toHaveLength(0);
  });
});
