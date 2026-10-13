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

  it("renders the title as an h2 when nested under the page's header", async () => {
    await render(<PageHeader icon={IconStar} title="Public Photos" titleOrder={2} />);

    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(container.querySelector("h2")?.textContent).toBe("Public Photos");
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

  // PhotoListView's default header is a PageHeader too: under a page that has its own, it must be
  // left out (`header`) or demoted (`titleOrder={2}`). A component file is always nested in a page.
  it("is not repeated by a photo list nested under a page header", () => {
    const sources = import.meta.glob<string>(["/src/**/*.tsx", "!/src/**/*.test.tsx"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const offenders = Object.entries(sources)
      .filter(([path, source]) => nestsSecondH1(path, source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("catches a nested photo list with its default header", () => {
    const list = "<PhotoListView title={t('x')} selectable />";
    const page = `<><PageHeader title="Page" />${list}</>`;

    expect(nestsSecondH1("/src/routes/_protected/page.tsx", page)).toBe(true);
    expect(nestsSecondH1("/src/components/sharing/Photos.tsx", list)).toBe(true);
    expect(nestsSecondH1("/src/routes/_protected/photos.tsx", list)).toBe(false);
    expect(nestsSecondH1("/src/routes/_protected/page.tsx", page.replace("selectable", "titleOrder={2}"))).toBe(false);
    expect(nestsSecondH1("/src/components/sharing/Photos.tsx", list.replace("selectable", "header={null}"))).toBe(
      false
    );
  });
});

// A `<PhotoListView ... />` element that renders its default header (its own h1), in a file that
// also renders a PageHeader or is not a route (so sits inside some page's body).
function nestsSecondH1(path: string, source: string): boolean {
  const nestedInPage = !path.startsWith("/src/routes/") || source.includes("<PageHeader");
  const lists = source.match(/<PhotoListView\b[\s\S]*?\/>/g) ?? [];
  return nestedInPage && lists.some(list => !/\bheader=|\btitleOrder=\{2\}/.test(list));
}
