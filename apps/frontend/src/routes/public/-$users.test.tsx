/**
 * A user's public page with `?album=`: the album is named by its public link's slug and read
 * through that link, like the album's own page. The album's id alone opens nothing for a visitor,
 * and an album of another user is not shown on this user's page.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route (its
 * `routeFileIgnorePrefix`).
 */
import { UserAlbum } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, type RouteComponent } from "@tanstack/react-router";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { createTestRouter, settle } from "../../util/memoryRouter.test-utils";
// Registers the route through the mocked createFileRoute.
import "./$users";

type RouteOptions = { component?: RouteComponent };

const stubs = vi.hoisted(() => ({
  options: undefined as RouteOptions | undefined,
  album: undefined as UserAlbum | undefined,
  slugsFetched: [] as string[],
  days: { data: [], isLoading: false },
}));

vi.mock("@tanstack/react-router", async importOriginal => {
  const router = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...router,
    createFileRoute: () => (options: RouteOptions) => {
      stubs.options = options;
      return { useParams: () => ({ users: "ann" }) };
    },
  };
});
vi.mock("../../api_client/urls", () => ({ serverAddress: "", shareAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({
  usePublicAlbumQuery: (slug: string) => {
    stubs.slugsFetched.push(slug);
    return { data: slug ? stubs.album : undefined };
  },
  // One result for every render: the page copies it into state when it changes.
  useFetchDateAlbumsQuery: () => stubs.days,
  useFetchDateAlbumQuery: () => ({ data: undefined }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: undefined }),
}));
vi.mock("../../components/sharing/usePublicPageTitle", () => ({ usePublicPageTitle: () => {} }));
vi.mock("../../components/photolist/PhotoListView", () => ({
  PhotoListView: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const albumOf = (username: string) =>
  UserAlbum.parse({
    id: "7",
    title: "Porto 2025",
    owner: { id: 1, username, first_name: "", last_name: "" },
    date: "",
    location: "",
    grouped_photos: [],
  });

const mounted: Array<() => Promise<void>> = [];

async function renderPage(search: string) {
  window.history.replaceState(null, "", `/public/ann${search}`);
  const options = defined(stubs.options, "the route options");
  const router = createTestRouter(
    [{ path: "/public/$users", component: defined(options.component) }],
    `/public/ann${search}`
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
  await settle(router);
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  stubs.album = albumOf("ann");
  stubs.slugsFetched = [];
});

afterEach(async () => {
  while (mounted.length) await defined(mounted.pop())();
  window.history.replaceState(null, "", "/");
});

describe("a user's public page with ?album=", () => {
  it("reads the album through its link slug", async () => {
    const container = await renderPage("?album=porto");
    expect(stubs.slugsFetched).toContain("porto");
    expect(container.querySelector("h1")?.textContent).toBe("Porto 2025");
  });

  it("does not show another user's album on this page", async () => {
    stubs.album = albumOf("bob");
    const container = await renderPage("?album=porto");
    expect(container.querySelector("h1")?.textContent).not.toBe("Porto 2025");
  });

  it("reads no album without the parameter", async () => {
    await renderPage("");
    expect(stubs.slugsFetched.every(slug => slug === "")).toBe(true);
  });
});
