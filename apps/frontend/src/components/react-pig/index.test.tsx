import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "../../i18n";
import Pig from ".";

const groups = [
  {
    date: "2024-03-12",
    location: "Berlin",
    numberOfItems: 1,
    items: [{ id: "photo-1", url: "hash1", aspectRatio: 1.5, dominantColor: "#123456", date: "2024-03-12T14:02:00Z" }],
  },
];

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

function renderPig(props: { textAlignment: "left" | "right"; headerSize: "large" | "normal" | "small" }) {
  act(() => {
    root!.render(<Pig imageData={groups} groupByDate getUrl={(url: any) => `/media/${url}`} {...props} />);
  });
  return container!.querySelector(".pig-header")!;
}

beforeAll(() => {
  // jsdom lays nothing out; give the grid a width so it computes a layout.
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1000 });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root && container) {
    act(() => root!.unmount());
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
      items: [{ id, url: id, aspectRatio: 1.5, dominantColor: "#123456" }],
    });

    act(() => {
      root!.render(<Pig imageData={[sameDay("a"), sameDay("b")]} groupByDate getUrl={(url: any) => `/media/${url}`} />);
    });

    expect(container.querySelectorAll(".pig-header")).toHaveLength(2);
    expect(errors.mock.calls.some(call => String(call[0]).includes("same key"))).toBe(false);
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
      items: [{ id: `photo-${id}`, url: id, aspectRatio: 1.5, dominantColor: "#123456" }],
    });
    const render = (data: ReturnType<typeof sameDay>[]) =>
      act(() => {
        root!.render(<Pig imageData={data} groupByDate getUrl={(url: any) => `/media/${url}`} />);
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
    expect(header.firstElementChild!.className).toContain("pig-header_location");

    const realigned = renderPig({ textAlignment: "left", headerSize: "large" });
    expect(realigned.firstElementChild!.className).toContain("pig-header_date");

    const before = renderPig({ textAlignment: "left", headerSize: "large" }).className;
    const resized = renderPig({ textAlignment: "left", headerSize: "small" }).className;
    expect(resized).not.toBe(before);
  });
});
