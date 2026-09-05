/**
 * A tag outlives its last photo, so its album page has to say something.
 *
 * Before this it passed no `emptyStateConfig`, and PhotoListView falls through
 * to `<div />` when there is nothing to show and no config — so deleting the
 * only photo carrying a tag left the page as a bare header with a tag icon and
 * no explanation of what had happened or where to go.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as
 * a route (its `routeFileIgnorePrefix`); without it every build warns that the
 * file exports no Route.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";

const stubs = vi.hoisted(() => ({
  tagAlbum: { id: 7, name: "beach", grouped_photos: [] as unknown[] },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    const route = () => route;
    route.useParams = () => ({ id: "7" });
    route.useSearch = () => ({});
    route.update = () => {};
    return route;
  },
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: "/album/tags/7" }),
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../../api_client/tags/hooks", () => ({
  useFetchTagAlbumQuery: () => ({ data: stubs.tagAlbum, isLoading: false }),
}));
// PhotoListView drags in the whole grid; the empty branch is all that matters.
vi.mock("../../../components/photolist/PhotoListView", () => ({
  PhotoListView: ({ emptyStateConfig, photoset }: any) => (
    <div data-testid="photolist">
      {photoset.length === 0 && emptyStateConfig ? (
        <div data-testid="empty">
          <h1>{emptyStateConfig.title}</h1>
          <p>{emptyStateConfig.description}</p>
          <a href={emptyStateConfig.actionLink}>{emptyStateConfig.actionLabel}</a>
        </div>
      ) : null}
    </div>
  ),
}));
vi.mock("../../../components/photolist/useMediaTypeFilter", () => ({
  useMediaTypeFilter: () => undefined,
}));
vi.mock("../../../components/photolist/mediaTypeFilter", () => ({
  validateMediaSearch: () => ({}),
}));

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

async function renderPage() {
  const { AlbumTagGallery } = await import("./tags.$id");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <AlbumTagGallery />
      </MantineProvider>
    );
  });
  return {
    container,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("a tag album with no photos", () => {
  it("explains itself instead of rendering a bare page", async () => {
    const page = await renderPage();

    const empty = page.container.querySelector('[data-testid="empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.querySelector("h1")?.textContent).toBe("This tag has no photos");
    expect(empty?.querySelector("p")?.textContent).toContain("press t to tag them");
    await page.unmount();
  });

  it("offers a way back to the tag list", async () => {
    const page = await renderPage();

    const action = page.container.querySelector('[data-testid="empty"] a');
    expect(action?.textContent).toBe("Back to all tags");
    expect(action?.getAttribute("href")).toBe("/album/tags");
    await page.unmount();
  });
});
