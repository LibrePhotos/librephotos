/**
 * An empty timeline sent every user to Library to scan, but only an admin can
 * set a user's scan folder: a regular user without one hit "Scan directory not
 * configured" there. They are pointed at what others shared with them instead,
 * on the timeline and on the other lists a scan fills (Photos, Videos,
 * Screenshots, Recently Added).
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";

const stubs = vi.hoisted(() => ({
  components: {} as Record<string, React.ComponentType | undefined>,
  auth: undefined as { access: { is_admin: boolean } } | undefined,
  user: undefined as { scan_directory: string } | undefined,
  emptyStateConfig: undefined as { description: string; actionLink?: string } | undefined,
  // One stable result, like a real query: a fresh array per render would loop
  // the routes' "flatten the groups" effect.
  emptyTimeline: { data: [], isLoading: false, refetch: () => {} },
  emptyRecent: { data: { results: [], date: null }, status: "success" },
  // The timeline's filter reads the URL; a bare "/" is the saved default.
  search: {},
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (options?: { component?: React.ComponentType }) => {
    stubs.components[path] = options?.component;
    return {};
  },
  useNavigate: () => () => {},
  useSearch: () => stubs.search,
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useFetchDateAlbumsQuery: () => stubs.emptyTimeline,
  useFetchDateAlbumQuery: () => ({}),
}));
vi.mock("../../api_client/photos/hooks/useFetchRecentlyAddedPhotosQuery", () => ({
  useFetchRecentlyAddedPhotosQuery: () => stubs.emptyRecent,
}));
vi.mock("../../api_client/auth/hooks", () => ({ useAccessToken: () => ({ data: stubs.auth }) }));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.user }),
}));
// The timeline's filter waits for the user's saved default (none here).
vi.mock("../../api_client/user/hooks", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.user }),
  useSaveDefaultTimelineFilterMutation: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("../../hooks/useWorkerStatus", () => ({ useWorkerStatus: () => ({ workerRunningJob: null }) }));
vi.mock("../../components/photolist/PhotoListView", () => ({
  PhotoListView: ({ emptyStateConfig }: { emptyStateConfig?: { description: string; actionLink?: string } }) => {
    stubs.emptyStateConfig = emptyStateConfig;
    return null;
  },
}));

beforeAll(async () => {
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  // The cold import of the routes takes seconds, longer when the suite runs in parallel
  await import("./index");
  await import("./photos");
  await import("./videos");
  await import("./screenshots");
  await import("./recent");
}, 30_000);

beforeEach(() => {
  stubs.emptyStateConfig = undefined;
});

async function renderRoute(path: string) {
  const Component = stubs.components[path]!;
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<Component />);
  });
  act(() => root.unmount());
  return stubs.emptyStateConfig!;
}

describe.each([
  "/_protected/",
  "/_protected/photos",
  "/_protected/videos",
  "/_protected/screenshots",
  "/_protected/recent",
])("the empty %s list", path => {
  it("points a user without a scan folder at what was shared with them", async () => {
    stubs.auth = { access: { is_admin: false } };
    stubs.user = { scan_directory: "" };

    const config = await renderRoute(path);

    expect(config.description).toBe(i18n.t("emptystate.photos.noscandirectory"));
    expect(config.actionLink).toBe("/sharing/withme/albums");
  });

  it("still sends users with a scan folder, and admins, to Library", async () => {
    stubs.auth = { access: { is_admin: false } };
    stubs.user = { scan_directory: "/photos/mara" };
    expect((await renderRoute(path)).actionLink).toBe("/library");

    stubs.auth = { access: { is_admin: true } };
    stubs.user = { scan_directory: "" };
    expect((await renderRoute(path)).actionLink).toBe("/library");
  });
});
