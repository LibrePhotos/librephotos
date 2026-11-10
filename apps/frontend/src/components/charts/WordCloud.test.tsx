/** #2744: the Things cloud names things in the interface language and searches for the English word. */
import type { WordCloudResponse } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { WordCloud } from "./WordCloud";

const navigate = vi.hoisted(() => vi.fn<(options: { to: string }) => void>());
const cloud = vi.hoisted((): WordCloudResponse => ({
  captions: [
    { label: "beach", y: 9 },
    { label: "kayak", y: 3 },
  ],
  people: [{ label: "Alice", y: 4 }],
  locations: [{ label: "Berlin", y: 2 }],
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../../api_client/stats/hooks", () => ({
  useFetchWordCloudQuery: () => ({ data: cloud, isLoading: false, isError: false }),
}));
// jsdom does no layout and has no ResizeObserver: one that reports a fixed width as soon as it
// observes, so the cloud has room to place its words.
const CONTAINER_WIDTH = 800;
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const size = { inlineSize: CONTAINER_WIDTH, blockSize: 0 };
      const entry: ResizeObserverEntry = {
        target,
        borderBoxSize: [size],
        contentBoxSize: [size],
        devicePixelContentBoxSize: [size],
        contentRect: new DOMRect(0, 0, CONTAINER_WIDTH, 0),
      };
      this.callback([entry], this);
    }
    unobserve() {}
    disconnect() {}
  }
);

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  i18n.addResourceBundle("de", "tags", { beach: "Strand", Alice: "nicht übersetzt" });
  await i18n.changeLanguage("de");
});

afterAll(async () => {
  i18n.removeResourceBundle("de", "tags");
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  navigate.mockReset();
});

async function render(type: string) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <MantineProvider>
        <WordCloud type={type} height={400} />
      </MantineProvider>
    )
  );
  // The size hook reads the observer's report in the next animation frame.
  await act(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  rendered = container;
  return [...container.querySelectorAll("svg text")];
}

let rendered: HTMLElement | undefined;

/** A word's shown text, without the <title> a translated thing carries. */
const shown = (word: Element) =>
  [...word.childNodes]
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent)
    .join("");

describe("WordCloud", () => {
  it("names things in the interface language, the English word in the tooltip", async () => {
    const words = await render("captions");

    expect(words.map(shown)).toEqual(["Strand", "kayak"]);
    expect(words.map(word => word.querySelector("title")?.textContent ?? null)).toEqual(["beach", null]);
  });

  it("searches for the stored English word", async () => {
    const words = await render("captions");

    await act(async () => words[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(navigate).toHaveBeenCalledWith({ to: "/search/beach" });
  });

  it("sizes the cloud to the width its container reports, less its margin", async () => {
    await render("captions");

    expect(rendered?.querySelector("svg")?.getAttribute("width")).toBe(String(CONTAINER_WIDTH - 50));
  });

  it("leaves people and places as they are", async () => {
    expect((await render("people")).map(shown)).toEqual(["Alice"]);
    expect((await render("location")).map(shown)).toEqual(["Berlin"]);
    expect(await render("other")).toEqual([]);
  });
});
