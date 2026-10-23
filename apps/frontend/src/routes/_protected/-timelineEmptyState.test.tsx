/**
 * An empty timeline sent every user to Library to scan, but only an admin can
 * set a user's scan folder: a regular user without one hit "Scan directory not
 * configured" there. They are pointed at what others shared with them instead,
 * on the timeline and on the other lists a scan fills (Photos, Videos,
 * Screenshots, Recently Added).
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import type { ImportJob } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";

const stubs = vi.hoisted(() => ({
  components: {} as Record<string, React.ComponentType | undefined>,
  auth: undefined as { access: { is_admin: boolean } } | undefined,
  user: undefined as { scan_directory: string } | undefined,
  emptyStateConfig: undefined as
    | { title?: string; description: string; actionLink?: string; progress?: { current: number; target: number } }
    | undefined,
  openImports: [] as ImportJob[],
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
  useSearch: ({ select }: { select: (search: Record<string, unknown>) => unknown }) => select(stubs.search),
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
vi.mock("../../components/upload/UploadContext", async importOriginal => ({
  ...(await importOriginal<typeof import("../../components/upload/UploadContext")>()),
  useOptionalUploadProcessing: () => ({ openImports: stubs.openImports }),
}));
vi.mock("../../hooks/useWorkerStatus", () => ({ useWorkerStatus: () => ({ workerRunningJob: null }) }));
// Pulls in the slideshow and its lightbox, which these tests never open.
vi.mock("../../components/memories/MemoriesStrip", () => ({ MemoriesStrip: () => null }));
vi.mock("../../components/photolist/PhotoListView", () => ({
  PhotoListView: ({ emptyStateConfig }: { emptyStateConfig?: typeof stubs.emptyStateConfig }) => {
    stubs.emptyStateConfig = emptyStateConfig;
    return null;
  },
}));

beforeAll(async () => {
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
  stubs.openImports = [];
});

async function renderRoute(path: string) {
  const Component = defined(stubs.components[path]);
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<Component />);
  });
  act(() => root.unmount());
  return defined(stubs.emptyStateConfig);
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

describe("the empty timeline while uploads are imported (#2739)", () => {
  it("says the uploads are on their way, like a running scan", async () => {
    stubs.auth = { access: { is_admin: false } };
    stubs.user = { scan_directory: "/photos/mara" };
    stubs.openImports = [
      {
        id: 3,
        job_id: "j1",
        queued_at: "2026-10-22T10:00:00Z",
        started_at: "2026-10-22T10:00:00Z",
        finished_at: null,
        finished: false,
        failed: false,
        cancelled: false,
        job_type: 20,
        job_type_str: "Import Uploads",
        started_by: { id: 1, username: "mara", first_name: "", last_name: "" },
        progress_current: 2,
        progress_target: 5,
        result: { stages: {} },
      },
    ];

    const config = await renderRoute("/_protected/");

    expect(config.title).toBe(i18n.t("emptystate.importing.title"));
    expect(config.progress).toEqual({ current: 2, target: 5 });
  });
});
