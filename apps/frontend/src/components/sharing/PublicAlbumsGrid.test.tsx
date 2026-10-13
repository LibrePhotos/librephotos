/**
 * The public links page rendered every public album as a SimpleGrid cell, so a library with
 * hundreds of them mounted hundreds of covers. It goes through TileGrid now, which mounts the
 * rows in view.
 */
import type { UserAlbumInfo } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { PublicAlbumsGrid } from "./PublicAlbumsGrid";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

const album = (id: number): UserAlbumInfo => ({
  id,
  title: `Trip ${id}`,
  cover_photo: null,
  photo_count: 3,
  owner: { id: 1, username: "owner", first_name: "", last_name: "" },
  shared_to: [],
  created_on: "2026-10-01T00:00:00Z",
  favorited: false,
  locked: false,
  public: true,
});

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
  // The grid measures the width it gets; jsdom has no ResizeObserver (nor any layout: the
  // window's width stands in).
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

describe("PublicAlbumsGrid", () => {
  it("mounts fewer than 100 of 500 public albums", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const gridRoot = createRoot(container);
    root = gridRoot;
    const onShare = vi.fn<(albumId: string, albumTitle: string, ownerUsername: string) => void>();
    await act(async () => {
      gridRoot.render(
        <MantineProvider>
          <PublicAlbumsGrid albums={Array.from({ length: 500 }, (_unused, i) => album(i + 1))} onShare={onShare} />
        </MantineProvider>
      );
    });

    const titles = Array.from(container.querySelectorAll("[data-line-clamp]"), title => title.textContent);
    expect(titles).toContain("Trip 1");
    expect(titles).not.toContain("Trip 500");
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.length).toBeLessThan(100);
    expect(container.querySelectorAll("button[aria-label='Sharing']").length).toBe(titles.length);
  });
});
