/**
 * The sort menu of the album lists (#620) with useAlbumSort: the button says the order, the menu
 * picks a key and a direction, the choice is stored per page and read back before the first render
 * (so Back restores the scroll position over the same order, #377), and Reset goes back to the
 * page's default.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { STORAGE_KEYS } from "../../util/storage";
import type { AlbumSortConfig } from "./albumSort";
import { AlbumSortMenu } from "./AlbumSortMenu";
import { useAlbumSort } from "./useAlbumSort";

type Album = Readonly<{ title: string; photo_count: number; first_photo_date?: number | null }>;

const config: AlbumSortConfig<Album> = {
  storageKey: STORAGE_KEYS.albumSortThings,
  defaultSort: { key: "name", direction: "asc" },
  options: [
    { key: "name", value: album => album.title },
    { key: "count", value: album => album.photo_count },
    {
      key: "date",
      value: album => album.first_photo_date,
      isAvailable: albums => albums.some(album => album.first_photo_date !== undefined),
    },
  ],
};

const albums: Album[] = [
  { title: "Beach", photo_count: 3, first_photo_date: 300 },
  { title: "Alps", photo_count: 1, first_photo_date: 100 },
  { title: "City", photo_count: 9, first_photo_date: 200 },
];
const olderServer: Album[] = albums.map(({ title, photo_count }) => ({ title, photo_count }));

/** The titles in the order of each render, first render included. */
let renders: string[][] = [];

function Page({ items }: Readonly<{ items: readonly Album[] }>) {
  const { sorted, menu } = useAlbumSort(config, items);
  renders.push(sorted.map(album => album.title));
  return <AlbumSortMenu {...menu} />;
}

let root: Root;
let container: HTMLDivElement;
let phone = false;

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it; the menu asks it whether this is a phone
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: phone && query.includes("max-width"),
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
  phone = false;
  localStorage.clear();
  renders = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function renderPage(items: readonly Album[] = albums) {
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <Page items={items} />
      </MantineProvider>
    );
  });
}

const button = () => defined(container.querySelector("button"));
const lastRender = () => defined(renders.at(-1));

async function openMenu() {
  await act(async () => {
    button().click();
  });
}

function radioItems() {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
}

function item(label: string): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>('[role^="menuitem"]')).find(
    element => element.textContent === label
  );
  return defined(found);
}

async function pick(label: string) {
  await openMenu();
  await act(async () => {
    item(label).click();
  });
}

describe("AlbumSortMenu", () => {
  it("shows the page in its default order and says so", async () => {
    await renderPage();

    expect(renders[0]).toEqual(["Alps", "Beach", "City"]);
    expect(button().textContent).toBe("Sort: Name");
    expect(button().getAttribute("aria-label")).toBe("Sort: Name, A to Z");
    expect(button().getAttribute("aria-haspopup")).toBe("menu");
  });

  it("lists the keys and directions as radio items, the current ones checked", async () => {
    await renderPage();
    await openMenu();

    const checked = radioItems().map(element => [element.textContent, element.getAttribute("aria-checked")]);
    expect(checked).toEqual([
      ["Name", "true"],
      ["Number of photos", "false"],
      ["Date taken", "false"],
      ["A to Z", "true"],
      ["Z to A", "false"],
    ]);
    // Already the default: nothing to reset
    expect(document.body.textContent).not.toContain("Reset to default");
  });

  it("sorts by a new key in its natural direction and stores the choice", async () => {
    await renderPage();
    await pick("Number of photos");

    expect(lastRender()).toEqual(["City", "Beach", "Alps"]);
    expect(button().getAttribute("aria-label")).toBe("Sort: Number of photos, Most first");
    expect(localStorage.getItem(STORAGE_KEYS.albumSortThings)).toBe(
      JSON.stringify({ key: "count", direction: "desc" })
    );

    await pick("Fewest first");
    expect(lastRender()).toEqual(["Alps", "Beach", "City"]);
  });

  it("reads the stored order before the first render", async () => {
    localStorage.setItem(STORAGE_KEYS.albumSortThings, JSON.stringify({ key: "date", direction: "asc" }));
    await renderPage();

    expect(renders[0]).toEqual(["Alps", "City", "Beach"]);
    expect(button().textContent).toBe("Sort: Date taken");
  });

  it("goes back to the default with Reset to default", async () => {
    localStorage.setItem(STORAGE_KEYS.albumSortThings, JSON.stringify({ key: "count", direction: "asc" }));
    await renderPage();
    await pick("Reset to default");

    expect(lastRender()).toEqual(["Alps", "Beach", "City"]);
    expect(localStorage.getItem(STORAGE_KEYS.albumSortThings)).toBe(JSON.stringify(config.defaultSort));
  });

  it("leaves out a key the server does not send, and falls back from a stored one without forgetting it", async () => {
    const stored = JSON.stringify({ key: "date", direction: "asc" });
    localStorage.setItem(STORAGE_KEYS.albumSortThings, stored);
    await renderPage(olderServer);
    await openMenu();

    expect(renders[0]).toEqual(["Alps", "Beach", "City"]);
    expect(radioItems().map(element => element.textContent)).not.toContain("Date taken");
    expect(localStorage.getItem(STORAGE_KEYS.albumSortThings)).toBe(stored);
  });

  it("is an icon named after the order on a phone", async () => {
    phone = true;
    localStorage.setItem(STORAGE_KEYS.albumSortThings, JSON.stringify({ key: "count", direction: "asc" }));
    await renderPage();

    expect(button().textContent).toBe("");
    expect(button().getAttribute("aria-label")).toBe("Sort: Number of photos, Fewest first");
    await pick("Number of photos");
    expect(lastRender()).toEqual(["Alps", "Beach", "City"]);
  });

  it("falls back to the default from a stored value it cannot read", async () => {
    localStorage.setItem(STORAGE_KEYS.albumSortThings, JSON.stringify({ key: "colour", direction: "up" }));
    await renderPage();

    expect(renders[0]).toEqual(["Alps", "Beach", "City"]);
  });
});
