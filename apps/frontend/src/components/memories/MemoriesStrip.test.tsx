import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryType, type Memory } from "../../api_client/memories";
import type { PigPhoto } from "../../api_client/photos/types";
import i18n from "../../i18n";
import { tempPigPhoto } from "../../util/util";
import { MemoriesStrip } from "./MemoriesStrip";

const stubs = vi.hoisted(() => ({
  memories: undefined as { results: Memory[] } | undefined,
  slideshowItems: undefined as PigPhoto[] | undefined,
}));

vi.mock("../../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../../api_client/memories", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api_client/memories")>()),
  useFetchMemoriesQuery: () => ({ data: stubs.memories }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("./MemorySlideshow", () => ({
  MemorySlideshow: ({ items }: { items: PigPhoto[] }) => {
    stubs.slideshowItems = items;
    return null;
  },
}));

let root: Root | undefined;
let container: HTMLDivElement;

beforeAll(async () => {
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
  // ScrollArea measures its viewport; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.memories = undefined;
  stubs.slideshowItems = undefined;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

function photo(hash: string): PigPhoto {
  return { ...tempPigPhoto(hash), image_hash: hash, isTemp: false };
}

function memory(id: string, yearsAgo: number, items: PigPhoto[]): Memory {
  return {
    id,
    type: MemoryType.YEARS_AGO,
    years_ago: yearsAgo,
    year: 2026 - yearsAgo,
    date: `${2026 - yearsAgo}-10-10`,
    start_date: `${2026 - yearsAgo}-10-10`,
    end_date: `${2026 - yearsAgo}-10-10`,
    location: "",
    numberOfItems: items.length,
    cover: items[0],
    items,
  };
}

async function renderStrip() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <MantineProvider>
        <MemoriesStrip />
      </MantineProvider>
    )
  );
}

describe("MemoriesStrip", () => {
  it("takes no room on the timeline when there is nothing to remember", async () => {
    stubs.memories = { results: [] };
    await renderStrip();
    expect(container.querySelector("section")).toBeNull();
  });

  it("shows a card per memory and links to the memories page", async () => {
    stubs.memories = {
      results: [memory("a", 1, [photo("a1")]), memory("b", 3, [photo("b1"), photo("b2")])],
    };
    await renderStrip();
    expect(container.textContent).toContain("1 year ago");
    expect(container.textContent).toContain("3 years ago");
    expect(container.querySelector('a[href="/memories"]')?.textContent).toBe("See all");
  });

  it("plays the memory that was clicked", async () => {
    const second = [photo("b1"), photo("b2")];
    stubs.memories = { results: [memory("a", 1, [photo("a1")]), memory("b", 3, second)] };
    await renderStrip();
    const buttons = container.querySelectorAll<HTMLButtonElement>('button[title="Play this memory"]');
    await act(async () => buttons[1].click());
    expect(stubs.slideshowItems).toEqual(second);
  });
});
