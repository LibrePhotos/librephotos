import { MantineProvider } from "@mantine/core";
import { IconStar } from "@tabler/icons-react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PAGE_HEADER_ICON_SIZE } from "../uiConstants";
import { PageHeader } from "./PageHeader";

let root: Root;
let container: HTMLDivElement;

const render = async (element: React.ReactNode) => {
  await act(async () => {
    root.render(<MantineProvider>{element}</MantineProvider>);
  });
};

beforeAll(() => {
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
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("PageHeader", () => {
  it("renders exactly one h1 with the title", async () => {
    await render(<PageHeader icon={IconStar} title="Albums" />);

    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("Albums");
    expect(container.querySelectorAll("h2, h3, h4, h5, h6")).toHaveLength(0);
  });

  it("renders the subtitle when given and leaves it out when not", async () => {
    await render(<PageHeader icon={IconStar} title="Albums" subtitle="3 albums" />);
    expect(container.textContent).toContain("3 albums");

    await render(<PageHeader icon={IconStar} title="Albums" />);
    expect(container.textContent).not.toContain("3 albums");
  });

  it("renders the actions beside the title", async () => {
    await render(<PageHeader icon={IconStar} title="Memories" actions={<button type="button">Play all</button>} />);

    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Play all");
    expect(container.querySelector("h1")?.contains(button)).toBe(false);
  });

  it("renders no actions wrapper when there are none", async () => {
    await render(<PageHeader icon={IconStar} title="Albums" />);

    expect(container.querySelector("button")).toBeNull();
  });

  it("gives the icon the shared size, the header stroke and no shrinking", async () => {
    await render(<PageHeader icon={IconStar} title="A very long title that would wrap" iconColor="red" />);

    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe(String(PAGE_HEADER_ICON_SIZE));
    expect(svg?.getAttribute("stroke-width")).toBe("1.5");
    expect(svg?.style.flexShrink).toBe("0");
  });

  it("shows a loader next to the title while loading", async () => {
    await render(<PageHeader icon={IconStar} title="Albums" loading />);

    expect(container.querySelector("h1 .mantine-Loader-root")).not.toBeNull();
  });

  it("shows no loader when not loading", async () => {
    await render(<PageHeader icon={IconStar} title="Albums" />);

    expect(container.querySelector(".mantine-Loader-root")).toBeNull();
  });
});

describe("the page h1", () => {
  // Every page header goes through PageHeader, so a page never grows a second heading style or
  // a stray h1. Route tests mock PhotoListView and do not render headers, so this checks the source.
  it("is only written by PageHeader outside tests", () => {
    const sources = import.meta.glob<string>(["/src/**/*.tsx", "!/src/**/*.test.tsx"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const offenders = Object.entries(sources)
      .filter(([path, source]) => path !== "/src/components/PageHeader.tsx" && /order=\{1\}|<h1[\s>]/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});
