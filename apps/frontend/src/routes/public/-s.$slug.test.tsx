/**
 * A public album's slideshow link (#1457): `?slideshow=1` opens the album with the lightbox on the
 * first photo, playing. Closing it drops the flag in place (Back leaves the album, a reload shows
 * the grid), and a visitor with the plain link starts the same slideshow with Play slideshow.
 * What the page fetches does not change: the same public album by its slug. The open photo is
 * `?photo=` (#2231), next to the flag, so a link can point at one photo of the album.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route (its
 * `routeFileIgnorePrefix`).
 */
import { Media, UserAlbum } from "@librephotos/api-client";
import type { PigPhoto } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, type RouteComponent } from "@tanstack/react-router";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lightbox } from "../../components/lightbox/Lightbox";
import type { PublicAlbumSearch } from "../../components/sharing/publicAlbum";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { createTestRouter, searchOf, settle, type TestRouter } from "../../util/memoryRouter.test-utils";
// Registers the route through the mocked createFileRoute. A static import: collecting the page's
// module tree takes longer than a hook may on a busy machine.
import "./s.$slug";

type LightboxProps = React.ComponentProps<typeof Lightbox>;
type RouteOptions = {
  component?: RouteComponent;
  validateSearch?: (search: Record<string, unknown>) => PublicAlbumSearch;
};

const stubs = vi.hoisted(() => ({
  options: undefined as RouteOptions | undefined,
  album: undefined as UserAlbum | undefined,
  slugsFetched: [] as string[],
  lightbox: [] as LightboxProps[],
}));

// The page runs in a real (in-memory) router; only its file route is stood in for, with the
// router's own hooks behind it.
vi.mock("@tanstack/react-router", async importOriginal => {
  const router = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...router,
    createFileRoute: () => (options: RouteOptions) => {
      stubs.options = options;
      return {
        useParams: () => ({ slug: "porto" }),
        useSearch: ({ select }: { select: (search: PublicAlbumSearch) => unknown }) =>
          router.useSearch({ strict: false, select }),
        useNavigate: () => router.useNavigate(),
      };
    },
  };
});
vi.mock("../../api_client/urls", () => ({ serverAddress: "", shareAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({
  usePublicAlbumQuery: (slug: string) => {
    stubs.slugsFetched.push(slug);
    return { data: stubs.album, isLoading: false, isError: false };
  },
  useSetPersonAlbumCoverMutation: () => ({ mutate: () => {} }),
  useSetEventCoverMutation: () => ({ mutate: () => {} }),
  useSetUserAlbumCoverMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../api_client/auth/hooks", () => ({ useAccessToken: () => ({ data: undefined }) }));
vi.mock("../../api_client/user/hooks", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: undefined, isLoading: false }),
  useUpdateUserMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../components/react-pig", () => ({ default: () => <div data-testid="pig" /> }));
vi.mock("../../components/scrollscrubber/ScrollScrubber", () => ({
  ScrollScrubber: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/lightbox/Lightbox", () => ({
  Lightbox: (props: LightboxProps) => {
    stubs.lightbox.push(props);
    return <div data-testid="lightbox" />;
  },
}));
// A public page opens none of the owner's dialogs; mocked so the test does not load their trees.
vi.mock("../../components/modals/AlbumCoverPickerModal", () => ({ AlbumCoverPickerModal: () => null }));
vi.mock("../../components/modals/AlbumEdit/AlbumEditModal", () => ({ AlbumEditModal: () => null }));
vi.mock("../../components/modals/ModalTagEdit", () => ({ ModalTagEdit: () => null }));
vi.mock("../../components/sharing/ModalAlbumShare", () => ({ ModalAlbumShare: () => null }));
vi.mock("../../components/sharing/ModalPhotosShare", () => ({ ModalPhotosShare: () => null }));
vi.mock("../../components/photolist/SelectionActions", () => ({ SelectionActions: () => null }));
vi.mock("../../components/photolist/SelectionBar", () => ({ SelectionBar: () => null }));
vi.mock("../../components/photolist/DefaultHeader", () => ({
  DefaultHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("../../components/photolist/TrashcanActions", () => ({ TrashcanActions: () => null }));

const FIRST = "00000000-0000-4000-8000-00000000000a";
const SECOND = "00000000-0000-4000-8000-00000000000b";

function photo(id: string): PigPhoto {
  return {
    id,
    image_hash: id,
    aspectRatio: 1,
    type: Media.IMAGE,
    is_hdr: false,
    rating: 0,
    shared_to: [],
    isTemp: false,
    has_raw_variant: false,
  };
}

const albumWith = (items: PigPhoto[]) =>
  UserAlbum.parse({
    id: "7",
    title: "Porto 2025",
    owner: { id: 1, username: "owner", first_name: "", last_name: "" },
    date: "",
    location: "",
    grouped_photos: [{ date: null, location: null, items }],
  });

const mounted: Array<() => Promise<void>> = [];
const queryClient = new QueryClient();

async function renderPage(url = "/public/s/porto") {
  const options = defined(stubs.options, "the route options");
  const router = createTestRouter(
    [{ path: "/public/s/$slug", component: defined(options.component), validateSearch: options.validateSearch }],
    url
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <RouterProvider router={router} />
        </MantineProvider>
      </QueryClientProvider>
    );
  });
  await settle(router);
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return { container, router };
}

async function step(router: TestRouter, run: () => void) {
  await act(async () => run());
  await settle(router);
}

const lightboxOpen = (container: HTMLElement) => container.querySelector('[data-testid="lightbox"]') !== null;

beforeAll(async () => {
  await i18n.changeLanguage("en");
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
});

beforeEach(() => {
  stubs.album = albumWith([photo(FIRST), photo(SECOND)]);
  stubs.slugsFetched = [];
  stubs.lightbox = [];
});

afterEach(async () => {
  while (mounted.length) await defined(mounted.pop())();
});

describe("public album route search", () => {
  it("reads the slideshow flag and the open photo, nothing else", () => {
    const validateSearch = defined(stubs.options?.validateSearch, "validateSearch");
    expect(validateSearch({ slideshow: 1 })).toEqual({ slideshow: 1 });
    expect(validateSearch({ slideshow: "nope", other: 2 })).toEqual({});
    expect(validateSearch({ slideshow: 1, photo: SECOND })).toEqual({ slideshow: 1, photo: SECOND });
  });
});

describe("public album slideshow link (#1457)", () => {
  it("opens the lightbox on the first photo in slideshow mode with ?slideshow=1", async () => {
    const { container } = await renderPage("/public/s/porto?slideshow=1");

    expect(lightboxOpen(container)).toBe(true);
    expect(defined(stubs.lightbox.at(-1))).toMatchObject({
      selectedImage: FIRST,
      startSlideshow: true,
      isPublic: true,
      publicAlbumSlug: "porto",
    });
    // The same album by the same slug: the flag changes how it is shown, not what is fetched.
    expect(new Set(stubs.slugsFetched)).toEqual(new Set(["porto"]));
  });

  it("shows the grid without the flag", async () => {
    const { container } = await renderPage();

    expect(lightboxOpen(container)).toBe(false);
    expect(container.querySelector('[data-testid="pig"]')).not.toBeNull();
  });

  it("drops the flag in place when the slideshow is closed", async () => {
    const { router, container } = await renderPage("/public/s/porto?slideshow=1");

    await step(router, () => defined(stubs.lightbox.at(-1)).onCloseRequest());

    expect(router.state.location.searchStr).toBe("");
    expect(router.history.length).toBe(1);
    expect(lightboxOpen(container)).toBe(false);
  });

  it("opens the photo a shared link names, and closes it in place", async () => {
    const { router, container } = await renderPage(`/public/s/porto?photo=${SECOND}`);
    expect(defined(stubs.lightbox.at(-1))).toMatchObject({ selectedImage: SECOND, startSlideshow: false });

    await step(router, () => defined(stubs.lightbox.at(-1)).onCloseRequest());
    expect(lightboxOpen(container)).toBe(false);
    expect(searchOf(router).get("photo")).toBeNull();
  });

  it("starts the slideshow from Play slideshow, labelled or as the phone's icon", async () => {
    const label = i18n.t("publicalbum.playSlideshow");
    const playButtons = (container: HTMLElement) =>
      [...container.querySelectorAll("button")].filter(
        button => button.textContent === label || button.getAttribute("aria-label") === label
      );
    expect(playButtons((await renderPage()).container)).toHaveLength(2);

    for (const index of [0, 1]) {
      const { container, router } = await renderPage();
      const button = defined(playButtons(container)[index]);
      await step(router, () => button.click());
      // In place: Back leaves the album, as before.
      expect(searchOf(router).get("slideshow")).toBe("1");
      expect(router.history.length).toBe(1);
    }
  });

  it("offers no Play slideshow on an empty album", async () => {
    stubs.album = albumWith([]);
    const { container } = await renderPage();

    const label = i18n.t("publicalbum.playSlideshow");
    expect(container.querySelector(`[aria-label="${label}"]`)).toBeNull();
    expect(container.textContent).not.toContain(label);
  });
});
