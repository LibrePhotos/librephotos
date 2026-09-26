import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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
