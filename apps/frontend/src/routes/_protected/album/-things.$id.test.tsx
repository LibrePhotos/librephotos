/**
 * A thing album's page title: the thing in the interface language (#2744), while loading a
 * placeholder, and for an album that is not there the section's name with its empty state.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotoListView } from "../../../components/photolist/PhotoListView";
import i18n from "../../../i18n";

type PhotoListProps = Pick<React.ComponentProps<typeof PhotoListView>, "title" | "emptyStateConfig" | "mediaType">;
type ThingAlbumQuery = {
  data: { id: number; title: string; grouped_photos: never[] } | undefined;
  isLoading: boolean;
  isError: boolean;
};

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  query: { data: undefined, isLoading: true, isError: false } as ThingAlbumQuery,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    // The route module hands its page component to createFileRoute's options.
    const route = (options?: { component?: React.ComponentType }) => {
      stubs.component = options?.component;
      return route;
    };
    route.useParams = () => ({ id: "3" });
    return route;
  },
}));
vi.mock("../../../api_client/albums/hooks", () => ({
  useFetchThingsAlbumQuery: () => stubs.query,
}));
// PhotoListView drags in the whole grid; its title and empty state are all that matter here.
vi.mock("../../../components/photolist/PhotoListView", () => ({
  PhotoListView: ({ title, emptyStateConfig, mediaType }: PhotoListProps) => (
    <div data-media-filter={String(mediaType !== undefined)}>
      <h1>{title}</h1>
      {emptyStateConfig ? <p data-testid="empty">{emptyStateConfig.title}</p> : null}
    </div>
  ),
}));
vi.mock("../../../components/photolist/useMediaTypeFilter", () => ({ useMediaTypeFilter: () => "photos" }));
vi.mock("../../../components/photolist/mediaTypeFilter", () => ({ validateMediaSearch: () => ({}) }));

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
  i18n.addResourceBundle("de", "tags", { beach: "Strand" });
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  i18n.removeResourceBundle("de", "tags");
  await i18n.changeLanguage("en");
});

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

async function renderPage() {
  await import("./things.$id");
  const Page = stubs.component;
  if (!Page) throw new Error("things.$id handed no component to createFileRoute");
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <Page />
      </MantineProvider>
    );
  });
  return { container, unmount: () => act(() => root.unmount()) };
}

describe("a thing album's page", () => {
  it("names the thing in the interface language", async () => {
    stubs.query = { data: { id: 3, title: "beach", grouped_photos: [] }, isLoading: false, isError: false };
    await i18n.changeLanguage("de");
    const page = await renderPage();

    expect(page.container.querySelector("h1")?.textContent).toBe("Strand");
    expect(page.container.querySelector('[data-testid="empty"]')).toBeNull();
    page.unmount();
  });

  it("shows the word as it is in English", async () => {
    stubs.query = { data: { id: 3, title: "beach", grouped_photos: [] }, isLoading: false, isError: false };
    const page = await renderPage();

    expect(page.container.querySelector("h1")?.textContent).toBe("beach");
    page.unmount();
  });

  it("says it is loading until the album is there", async () => {
    stubs.query = { data: undefined, isLoading: true, isError: false };
    const page = await renderPage();

    expect(page.container.querySelector("h1")?.textContent).toBe(i18n.t("loading"));
    page.unmount();
  });

  it("explains an album that is not there, without a photo filter", async () => {
    stubs.query = { data: undefined, isLoading: false, isError: true };
    const page = await renderPage();

    expect(page.container.querySelector("h1")?.textContent).toBe(i18n.t("things"));
    expect(page.container.querySelector('[data-testid="empty"]')).not.toBeNull();
    expect(page.container.querySelector("[data-media-filter]")?.getAttribute("data-media-filter")).toBe("false");
    page.unmount();
  });
});
