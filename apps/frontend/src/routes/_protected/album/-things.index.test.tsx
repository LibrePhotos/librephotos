/**
 * #2234: a thing album without a cover photo could not be opened.
 *
 * The tile linked to the album only through its cover, and the grid rendered
 * nothing for an album whose cover_photos list is empty, so its title and
 * count sat under an empty space with no link at all. Every album now gets a
 * cover (or a placeholder) and a title that both open it.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as
 * a route.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
// Imported statically so the module graph loads while the file is collected
// (see -places.issue535.test.tsx); running it hands the page component to the
// createFileRoute stub below.
import "./things.index";

/** The route stub: createFileRoute("...")(options) and its chained calls hand back the same function. */
type RouteStub = (options?: { component?: React.ComponentType }) => RouteStub;

type LinkStubProps = { children?: React.ReactNode; to: string; params?: { id: string } };

const stubs = vi.hoisted(() => ({
  component: null as React.ComponentType | null,
  albums: [
    { id: 1, title: "beach", thing_type: "hashtag_attribute", photo_count: 12, cover_photos: [{ image_hash: "h1" }] },
    // Every stored cover hidden or trashed
    { id: 2, title: "harbour", thing_type: "hashtag_attribute", photo_count: 6, cover_photos: [] },
  ],
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    const route: RouteStub = options => {
      stubs.component = options?.component ?? null;
      return route;
    };
    return route;
  },
  // The href the real Link builds from `to` and `params`
  Link: ({ children, to, params }: LinkStubProps) => <a href={to.replace("$id", params?.id ?? "")}>{children}</a>,
}));
vi.mock("../../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../../api_client/albums/hooks", () => ({
  useFetchThingsAlbumsQuery: () => ({ data: stubs.albums, isFetching: false }),
}));

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
  await i18n.changeLanguage("en");
});

async function renderPage() {
  const Page = stubs.component;
  if (!Page) throw new Error("the route did not register its component");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <Page />
      </MantineProvider>
    );
  });
  return {
    links: (href: string) => Array.from(container.querySelectorAll(`a[href="${href}"]`)),
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("the things page", () => {
  it("links an album without a cover photo from its tile and its title", async () => {
    const page = await renderPage();

    const links = page.links("/album/things/2");
    // The placeholder tile and the title
    expect(links).toHaveLength(2);
    expect(links.some(link => link.textContent?.includes("harbour"))).toBe(true);
    await page.unmount();
  });

  it("links an album with a cover from its cover and its title", async () => {
    const page = await renderPage();

    const links = page.links("/album/things/1");
    expect(links).toHaveLength(2);
    expect(links.some(link => link.querySelector("img") !== null)).toBe(true);
    expect(links.some(link => link.textContent?.includes("beach"))).toBe(true);
    await page.unmount();
  });
});
