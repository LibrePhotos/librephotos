/**
 * The per-view media filter (#2215, #2216): one menu button that names the current choice,
 * an item for every media type (Documents included) with a check on the current one, a dot instead of the label on a
 * phone, and a "Videos only · Show all" hint under the page title.
 */
import type { MediaType } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { MediaTypeHint } from "./MediaTypeHint";
import { MediaTypeSelector } from "./MediaTypeSelector";

type Search = Record<string, unknown>;

const stubs = vi.hoisted(() => ({
  media: undefined as MediaType | undefined,
  phone: false,
  navigate: vi.fn<(options: { to: string; search: (prev: Search) => Search }) => Promise<void>>(() =>
    Promise.resolve()
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({ media: stubs.media }),
  useNavigate: () => stubs.navigate,
}));

beforeAll(async () => {
  // jsdom has no matchMedia; the phone layout answers the small-screen query
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: stubs.phone && query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.media = undefined;
  stubs.phone = false;
  stubs.navigate.mockClear();
});

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach(root => root.unmount()));
});

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<MantineProvider env="test">{node}</MantineProvider>);
  });
  return container;
}

async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("nothing to click");
  await act(async () => {
    element.click();
  });
}

const menuItems = () => Array.from(document.body.querySelectorAll('[role="menuitem"]'));
const isChecked = (item: Element) => item.querySelector(".tabler-icon-check") !== null;

/** The search the last navigate call wrote, from a page whose search was `prev`. */
function lastSearch(prev: Search = { media: "videos", page: 2 }): Search {
  const call = defined(stubs.navigate.mock.lastCall);
  expect(call[0].to).toBe(".");
  return call[0].search(prev);
}

describe("MediaTypeSelector", () => {
  it("names the current choice and offers every media type", async () => {
    const container = await render(<MediaTypeSelector />);
    const button = defined(container.querySelector("button"));
    expect(button.textContent).toBe("All media");
    expect(button.getAttribute("aria-label")).toBe("Media type: All media");

    await click(button);
    const items = menuItems();
    expect(items.map(item => item.textContent)).toEqual([
      "All media",
      "Photos only",
      "Videos only",
      "Screenshots only",
      "Documents only",
    ]);
    expect(items.map(isChecked)).toEqual([true, false, false, false, false]);
  });

  it("writes the choice into the URL and clears it for All media", async () => {
    stubs.media = "videos";
    const container = await render(<MediaTypeSelector />);
    expect(defined(container.querySelector("button")).textContent).toBe("Videos only");

    await click(container.querySelector("button"));
    const items = menuItems();
    expect(items.map(isChecked)).toEqual([false, false, true, false, false]);

    await click(items.find(item => item.textContent === "Documents only"));
    expect(lastSearch()).toEqual({ media: "documents", page: 2 });

    await click(container.querySelector("button"));
    await click(menuItems()[0]);
    expect(lastSearch()).toEqual({ media: undefined, page: 2 });
  });

  it("is an icon with a dot on a phone", async () => {
    stubs.phone = true;
    stubs.media = "screenshots";
    const container = await render(<MediaTypeSelector />);
    const button = defined(container.querySelector("button"));
    expect(button.textContent).toBe("");
    expect(button.getAttribute("aria-label")).toBe("Media type: Screenshots only");
    expect(container.querySelector(".mantine-Indicator-indicator")).not.toBeNull();
  });

  it("has no dot on a phone while it shows everything", async () => {
    stubs.phone = true;
    const container = await render(<MediaTypeSelector />);
    expect(container.querySelector(".mantine-Indicator-indicator")).toBeNull();
  });
});

describe("MediaTypeHint", () => {
  it("says what the filter shows and offers the way back", async () => {
    stubs.media = "documents";
    const container = await render(<MediaTypeHint />);
    expect(container.querySelector("p")?.textContent).toBe("Documents only · Show all");

    await click(container.querySelector("button"));
    expect(lastSearch()).toEqual({ media: undefined, page: 2 });
  });

  it("is not there without a filter", async () => {
    const container = await render(<MediaTypeHint />);
    expect(container.querySelector("p")).toBeNull();
  });
});
