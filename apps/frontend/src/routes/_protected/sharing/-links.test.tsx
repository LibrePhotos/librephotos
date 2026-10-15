/**
 * The Photos tab of "Public links" rendered two h1s: the page's own and the
 * title of the photo list under it. The list keeps its sticky header there,
 * because its Select button and selection bar are how photos are picked, but
 * its title is a section heading under the page's h1.
 *
 * The real PhotoListView, DefaultHeader and PageHeader render; only the grid,
 * the dialogs and the data are stubbed.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import { Media } from "@librephotos/api-client";
import type { DatePhotosGroup, PigPhoto } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  search: { tab: "photos" } as { tab?: string },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options?: { component?: React.ComponentType }) => {
    stubs.component = options?.component;
    return {
      useNavigate: () => () => {},
      useSearch: ({ select }: { select: (search: { tab?: string }) => unknown }) => select(stubs.search),
    };
  },
  useLocation: () => ({ pathname: "/sharing/links" }),
  useNavigate: () => () => {},
  useRouter: () => ({ state: { location: { pathname: "/sharing/links" } } }),
  // The photo list's lightbox reads `?photo=`: none here.
  useSearch: () => undefined,
}));
vi.mock("../../../api_client/auth/hooks", () => ({
  useAccessToken: () => ({ data: { access: { user_id: 1, is_admin: true, name: "admin" } } }),
}));
vi.mock("../../../api_client/user/hooks", () => {
  const self = { data: { id: 1, scan_directory: "/data", image_scale: 1 }, isLoading: false };
  return {
    useCurrentUserSelfDetailsQuery: () => self,
    useFetchUserSelfDetailsQuery: () => self,
    useFetchUserListQuery: () => ({ data: [] }),
    useUpdateUserMutation: () => ({ mutate: () => {} }),
  };
});
vi.mock("../../../api_client/albums/hooks", () => {
  const photo = (id: string): PigPhoto => ({
    id,
    image_hash: id,
    aspectRatio: 1,
    type: Media.IMAGE,
    is_hdr: false,
    rating: 0,
    shared_to: [],
    isTemp: false,
    has_raw_variant: false,
  });
  const groups: DatePhotosGroup[] = [{ date: "2024-01-01", location: "", items: [photo("a"), photo("b")] }];
  const dateAlbums = { data: groups, isLoading: false };
  const userAlbums = { data: [], isLoading: false };
  return {
    useFetchDateAlbumsQuery: () => dateAlbums,
    useFetchUserAlbumsQuery: () => userAlbums,
    useRemovePhotoFromUserAlbumMutation: () => ({ mutate: () => {} }),
    useSetPersonAlbumCoverMutation: () => ({ mutate: () => {} }),
    useSetUserAlbumCoverMutation: () => ({ mutate: () => {} }),
  };
});
vi.mock("../../../api_client/photos/hooks", () => {
  const shares = { data: [], isLoading: false };
  const noDetails = { data: undefined, isError: false };
  return { useFetchPhotoSharesQuery: () => shares, useFetchPhotoDetailsQuery: () => noDetails };
});
vi.mock("../../../components/react-pig", () => ({ default: () => <div data-testid="pig" /> }));
vi.mock("../../../components/scrollscrubber/ScrollScrubber", () => ({
  ScrollScrubber: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/photolist/PhotoListDialogs", () => ({ PhotoListDialogs: () => null }));
vi.mock("../../../components/photolist/SelectionActions", () => ({ SelectionActions: () => null }));
vi.mock("../../../components/photolist/TrashcanActions", () => ({ TrashcanActions: () => null }));
vi.mock("../../../components/sharing/ModalAlbumShare", () => ({ ModalAlbumShare: () => null }));
vi.mock("../../../components/sharing/PhotoSharesSection", () => ({ PhotoSharesSection: () => null }));
vi.mock("../../../components/sharing/PublicAlbumsGrid", () => ({ PublicAlbumsGrid: () => null }));

let root: Root | undefined;
let container: HTMLDivElement;

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
  await import("./links");
}, 30_000);

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});

async function renderTab(tab: "albums" | "photos") {
  stubs.search = { tab };
  const PublicLinks = stubs.component;
  if (!PublicLinks) {
    throw new Error("the route module did not register its component");
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider env="test">
          <PublicLinks />
        </MantineProvider>
      </QueryClientProvider>
    );
  });
}

const headings = (selector: string) => Array.from(container.querySelectorAll(selector), h => h.textContent);

describe("public links page headings", () => {
  it("has one h1, the page's, on the Photos tab", async () => {
    await renderTab("photos");

    expect(headings("h1")).toEqual([i18n.t("sharing.publicLinks")]);
  });

  it("keeps the photo list's title, as a section heading, and its Select button", async () => {
    await renderTab("photos");

    expect(headings("h2")).toEqual([i18n.t("sharing.publicPhotos")]);
    // The selection bar comes up from it (#2240)
    expect(container.textContent).toContain(i18n.t("selectionbar.selectmode"));
  });

  it("has one h1 on the Albums tab", async () => {
    await renderTab("albums");

    expect(headings("h1")).toEqual([i18n.t("sharing.publicLinks")]);
  });
});
