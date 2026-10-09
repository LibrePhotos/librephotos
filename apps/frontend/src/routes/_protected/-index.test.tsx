/**
 * The main timeline "/" and its filter (issue #2130).
 *
 * The URL's filter params override the user's saved default key by key, the
 * date-album queries get the resolved filter, and select-all carries the same
 * filter: "select all, then delete" must never reach the screenshots the
 * timeline hides. The timeline waits for the saved default before fetching.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  search: {} as Record<string, unknown>,
  user: undefined as { id: number; photo_count?: number; default_timeline_filter: Record<string, unknown> } | undefined,
  dayCalls: [] as { options: any; queryOptions: any }[],
  navigate: vi.fn(),
  saveDefault: vi.fn(),
  listCalls: [] as { options: any; queryOptions: any }[],
  // One object, like the query cache: a fresh one per render loops the
  // route's effect that flattens it.
  listResult: { data: [], isLoading: false, refetch: () => {} },
  listProps: undefined as any,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options?: { component?: React.ComponentType }) => {
    stubs.component = options?.component;
    return {};
  },
  useNavigate: () => stubs.navigate,
  useSearch: () => stubs.search,
}));
vi.mock("../../api_client/user/hooks", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.user }),
  useSaveDefaultTimelineFilterMutation: () => ({ mutate: stubs.saveDefault, isPending: false }),
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useFetchDateAlbumsQuery: (options: any, queryOptions: any) => {
    stubs.listCalls.push({ options, queryOptions });
    return stubs.listResult;
  },
  useFetchDateAlbumQuery: (options: any, queryOptions: any) => {
    stubs.dayCalls.push({ options, queryOptions });
    return {};
  },
}));
vi.mock("../../hooks/useWorkerStatus", () => ({ useWorkerStatus: () => ({ workerRunningJob: undefined }) }));
vi.mock("../../components/photolist/PhotoListView", () => ({
  PhotoListView: (props: any) => {
    stubs.listProps = props;
    return null;
  },
}));

beforeAll(async () => {
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  // The cold import of the route takes seconds, longer when the suite runs in parallel
  await import("./index");
}, 30_000);

beforeEach(() => {
  stubs.search = {};
  stubs.user = { id: 1, default_timeline_filter: { hide_screenshots: true } };
  stubs.navigate.mockReset();
  stubs.saveDefault.mockReset();
  stubs.listCalls = [];
  stubs.dayCalls = [];
  stubs.listProps = undefined;
});

async function renderTimeline() {
  const Timeline = stubs.component!;
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<Timeline />);
  });
  return stubs.listCalls.at(-1)!;
}

describe("the main timeline filter", () => {
  it("applies the saved default to the queries and to select-all", async () => {
    const { options, queryOptions } = await renderTimeline();
    expect(queryOptions.skip).toBe(false);
    expect(options.timelineFilter).toEqual({
      media: "all",
      hide_screenshots: true,
      hide_documents: false,
      favorites: false,
    });
    expect(stubs.listProps.photosetQuery).toEqual({ hide_screenshots: true });
  });

  it("lets URL params override the default key by key", async () => {
    stubs.search = { hide_screenshots: false, hide_documents: true, media: "photos" };
    const { options } = await renderTimeline();
    expect(options.timelineFilter).toEqual({
      media: "photos",
      hide_screenshots: false,
      hide_documents: true,
      favorites: false,
    });
    // Select-all acts on exactly this view.
    expect(stubs.listProps.photosetQuery).toEqual({ media: "photos", hide_documents: true });
  });

  it("waits for the saved default before fetching", async () => {
    stubs.user = undefined;
    const { queryOptions } = await renderTimeline();
    expect(queryOptions.skip).toBe(true);
    expect(stubs.listProps.loading).toBe(true);
  });

  it("writes a changed filter to the URL as overrides of the default", async () => {
    await renderTimeline();
    const popover = stubs.listProps.headerActions.props;
    await act(async () => {
      popover.onChange({ media: "videos", hide_screenshots: true, hide_documents: false, favorites: false });
    });
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/", search: { media: "videos" }, replace: true });

    await act(async () => {
      popover.onReset();
    });
    expect(stubs.navigate).toHaveBeenLastCalledWith({ to: "/", search: {}, replace: true });
  });

  it("saves the view as the default and then drops the URL overrides", async () => {
    stubs.search = { hide_documents: true };
    await renderTimeline();
    await act(async () => {
      stubs.listProps.headerActions.props.onSaveDefault();
    });
    const [request, callbacks] = stubs.saveDefault.mock.calls[0];
    expect(request).toEqual({
      userId: 1,
      filter: { media: "all", hide_screenshots: true, hide_documents: true, favorites: false },
    });
    await act(async () => {
      callbacks.onSuccess();
    });
    expect(stubs.navigate).toHaveBeenLastCalledWith({ to: "/", search: {}, replace: true });
  });

  it("says what the filter hides under the counter", async () => {
    await renderTimeline();
    expect(stubs.listProps.additionalSubHeader.props.children).toBe("Filtered: no screenshots");

    stubs.user = { id: 1, default_timeline_filter: {} };
    await renderTimeline();
    expect(stubs.listProps.additionalSubHeader).toBeNull();
  });

  it("hands the popover its readiness", async () => {
    stubs.user = undefined;
    await renderTimeline();
    expect(stubs.listProps.headerActions.props.ready).toBe(false);
  });

  it("tells an empty library from a filter that hides everything", async () => {
    stubs.user = { id: 1, photo_count: 0, default_timeline_filter: { hide_screenshots: true } };
    await renderTimeline();
    expect(stubs.listProps.emptyStateConfig.actionLink).toBe("/library");

    stubs.user = { id: 1, photo_count: 12, default_timeline_filter: { hide_screenshots: true } };
    await renderTimeline();
    expect(stubs.listProps.emptyStateConfig.title).toBe("Nothing matches this filter");
  });

  it("does not ask for a day of the old list after the filter changed", async () => {
    const Timeline = stubs.component!;
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(<Timeline />);
    });
    await act(async () => {
      stubs.listProps.updateGroups([{ id: "day-1", items: [{ id: "0", isTemp: true }] }]);
    });
    expect(stubs.dayCalls.at(-1)!.options.album_date_id).toBe("day-1");
    expect(stubs.dayCalls.at(-1)!.queryOptions.skip).toBe(false);

    stubs.search = { media: "videos" };
    await act(async () => {
      root.render(<Timeline />);
    });
    expect(stubs.dayCalls.at(-1)!.queryOptions.skip).toBe(true);
  });
});
