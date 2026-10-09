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
import type { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { Media } from "../../api_client/photos/types";
import type { PigPhoto } from "../../api_client/photos/types";
import type { PhotoListView } from "../../components/photolist/PhotoListView";
import { TimelineFilterPopover } from "../../components/photolist/TimelineFilterPopover";
import i18n from "../../i18n";

type ListArgs = Parameters<typeof useFetchDateAlbumsQuery>;
type DayArgs = Parameters<typeof useFetchDateAlbumQuery>;
type PhotoListViewProps = React.ComponentProps<typeof PhotoListView>;

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  search: {} as Record<string, unknown>,
  user: undefined as { id: number; photo_count?: number; default_timeline_filter: Record<string, unknown> } | undefined,
  dayCalls: [] as { options: DayArgs[0]; queryOptions: DayArgs[1] }[],
  navigate: vi.fn(),
  saveDefault: vi.fn(),
  listCalls: [] as { options: ListArgs[0]; queryOptions: ListArgs[1] }[],
  // One object, like the query cache: a fresh one per render loops the
  // route's effect that flattens it.
  listResult: { data: [], isLoading: false, refetch: () => {} },
  listProps: undefined as PhotoListViewProps | undefined,
  noScanDirectory: false,
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
  useFetchDateAlbumsQuery: (...[options, queryOptions]: ListArgs) => {
    stubs.listCalls.push({ options, queryOptions });
    return stubs.listResult;
  },
  useFetchDateAlbumQuery: (...[options, queryOptions]: DayArgs) => {
    stubs.dayCalls.push({ options, queryOptions });
    return {};
  },
}));
vi.mock("../../hooks/useWorkerStatus", () => ({ useWorkerStatus: () => ({ workerRunningJob: undefined }) }));
vi.mock("../../components/photolist/useScanEmptyStateAction", () => ({
  useHasNoScanDirectory: () => stubs.noScanDirectory,
}));
vi.mock("../../components/photolist/PhotoListView", () => ({
  PhotoListView: (props: PhotoListViewProps) => {
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
  stubs.noScanDirectory = false;
});

// What the route last rendered PhotoListView with.
function listProps() {
  if (!stubs.listProps) throw new Error("PhotoListView was not rendered");
  return stubs.listProps;
}

// The props of the Filter button the route puts in the header toolbar.
function popoverProps() {
  const button = listProps().headerActions;
  if (!React.isValidElement<React.ComponentProps<typeof TimelineFilterPopover>>(button)) {
    throw new Error("no filter button");
  }
  expect(button.type).toBe(TimelineFilterPopover);
  return button.props;
}

// A day's placeholder tile, standing for a photo of a page not loaded yet.
const placeholder: PigPhoto = {
  id: "0",
  image_hash: "",
  aspectRatio: 1,
  type: Media.IMAGE,
  is_hdr: false,
  rating: 0,
  shared_to: [],
  isTemp: true,
  has_raw_variant: false,
};

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
    expect(queryOptions?.skip).toBe(false);
    expect(options.timelineFilter).toEqual({
      media: "all",
      hide_screenshots: true,
      hide_documents: false,
      favorites: false,
    });
    expect(listProps().photosetQuery).toEqual({ hide_screenshots: true });
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
    expect(listProps().photosetQuery).toEqual({ media: "photos", hide_documents: true });
  });

  it("waits for the saved default before fetching", async () => {
    stubs.user = undefined;
    const { queryOptions } = await renderTimeline();
    expect(queryOptions?.skip).toBe(true);
    expect(listProps().loading).toBe(true);
  });

  it("writes a changed filter to the URL as overrides of the default", async () => {
    await renderTimeline();
    const popover = popoverProps();
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
      popoverProps().onSaveDefault();
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
    const summary = listProps().additionalSubHeader;
    expect(React.isValidElement<{ children?: React.ReactNode }>(summary) && summary.props.children).toBe(
      "Filtered: no screenshots"
    );

    stubs.user = { id: 1, default_timeline_filter: {} };
    await renderTimeline();
    expect(listProps().additionalSubHeader).toBeNull();
  });

  it("hands the popover its readiness", async () => {
    stubs.user = undefined;
    await renderTimeline();
    expect(popoverProps().ready).toBe(false);
  });

  it("tells an empty library from a filter that hides everything", async () => {
    stubs.user = { id: 1, photo_count: 0, default_timeline_filter: { hide_screenshots: true } };
    await renderTimeline();
    expect(listProps().emptyStateConfig?.actionLink).toBe("/library");

    stubs.user = { id: 1, photo_count: 12, default_timeline_filter: { hide_screenshots: true } };
    await renderTimeline();
    expect(listProps().emptyStateConfig?.title).toBe("Nothing matches this filter");
  });

  it("points a user without a scan folder at what others shared, unless a filter hides their photos", async () => {
    stubs.noScanDirectory = true;
    stubs.user = { id: 1, photo_count: 0, default_timeline_filter: {} };
    await renderTimeline();
    expect(listProps().emptyStateConfig?.actionLink).toBe("/sharing/withme/albums");

    stubs.user = { id: 1, photo_count: 12, default_timeline_filter: { hide_screenshots: true } };
    await renderTimeline();
    expect(listProps().emptyStateConfig?.title).toBe("Nothing matches this filter");
  });

  it("does not ask for a day of the old list after the filter changed", async () => {
    const Timeline = stubs.component!;
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(<Timeline />);
    });
    await act(async () => {
      listProps().updateGroups!([{ id: "day-1", date: null, items: [placeholder] }]);
    });
    expect(stubs.dayCalls.at(-1)!.options.album_date_id).toBe("day-1");
    expect(stubs.dayCalls.at(-1)!.queryOptions?.skip).toBe(false);

    stubs.search = { media: "videos" };
    await act(async () => {
      root.render(<Timeline />);
    });
    expect(stubs.dayCalls.at(-1)!.queryOptions?.skip).toBe(true);
  });
});
