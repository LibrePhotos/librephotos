import type { MediaType, PhotoOrder, SearchFilters, SearchSort } from "@librephotos/api-client";
import { Photoset, PigPhoto } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PhotoListView } from "../../components/photolist/PhotoListView";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";

type PhotoListViewProps = React.ComponentProps<typeof PhotoListView>;
type RouteOptions = { component?: React.ComponentType };
type ListOptions = { photosetType: Photoset; order?: PhotoOrder };
type Asked = [string, MediaType | undefined, SearchFilters | undefined, SearchSort | undefined, unknown];

const video = PigPhoto.parse({
  id: "00000000-0000-4000-8000-000000000001",
  image_hash: "v1",
  aspectRatio: 1,
  size: 9000,
});

const stubs = vi.hoisted(() => ({
  routes: {} as Record<string, RouteOptions>,
  order: "newest" as PhotoOrder,
  listOptions: [] as [ListOptions, { skip?: boolean } | undefined][],
  dayOptions: [] as [ListOptions, { skip?: boolean } | undefined][],
  asked: [] as Asked[],
  props: undefined as PhotoListViewProps | undefined,
  dayQuery: { data: [], isLoading: false, isError: false, isFetching: false, refetch: () => Promise.resolve() },
  sizeQuery: {
    data: undefined as { photosFlat: PigPhoto[]; photosGroupedByDate: []; count?: number } | undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: () => Promise.resolve(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (options: RouteOptions) => {
    stubs.routes[path] = options;
    return {};
  },
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useFetchDateAlbumsQuery: (options: ListOptions, queryOptions?: { skip?: boolean }) => {
    stubs.listOptions.push([options, queryOptions]);
    return stubs.dayQuery;
  },
  useDateAlbumDayPages: (options: ListOptions, queryOptions?: { skip?: boolean }) => {
    stubs.dayOptions.push([options, queryOptions]);
    return () => {};
  },
}));
vi.mock("../../api_client/search/hooks", () => ({
  useSearchPhotosQuery: (
    term: string,
    mediaType?: MediaType,
    filters?: SearchFilters,
    sort?: SearchSort,
    options?: unknown
  ) => {
    stubs.asked.push([term, mediaType, filters, sort, options]);
    return stubs.sizeQuery;
  },
}));
vi.mock("../../api_client/user/hooks/usePhotoOrder", () => ({
  usePhotoOrder: () => ({ order: stubs.order, ready: true }),
}));
vi.mock("../../components/photolist/useScanEmptyStateAction", () => ({
  useScanEmptyStateAction: (description: string) => ({ description }),
}));
vi.mock("../../components/photolist/PhotoListView", () => ({
  PhotoListView: (props: PhotoListViewProps) => {
    stubs.props = props;
    return null;
  },
}));

beforeAll(async () => {
  await i18n.changeLanguage("en");
  await import("./videos");
}, 30_000);

afterEach(() => {
  stubs.order = "newest";
  stubs.listOptions = [];
  stubs.dayOptions = [];
  stubs.asked = [];
  stubs.props = undefined;
  stubs.sizeQuery.data = undefined;
  localStorage.clear();
});

async function renderVideos() {
  const Page = defined(stubs.routes["/_protected/videos"]?.component);
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<Page />);
  });
  await act(async () => {
    root.unmount();
  });
  return defined(stubs.props);
}

describe("the Videos page sort", () => {
  it("lists the days in the user's photo order by default and hands that order to the list", async () => {
    stubs.order = "oldest";
    const props = await renderVideos();

    expect(stubs.listOptions.at(-1)).toEqual([{ photosetType: Photoset.VIDEOS, order: "oldest" }, { skip: false }]);
    expect(stubs.dayOptions.at(-1)).toEqual([{ photosetType: Photoset.VIDEOS, order: "oldest" }, { skip: false }]);
    expect(props.sort).toBe("oldest");
    expect(props.sortTotal).toBeUndefined();
    expect(props.updateGroups).toBeDefined();
  });

  it("lists the largest videos without a search term, with their total, instead of the days", async () => {
    localStorage.setItem("lp:photoSort.videos.v1", JSON.stringify("largest"));
    stubs.sizeQuery.data = { photosFlat: [video], photosGroupedByDate: [], count: 4200 };
    const props = await renderVideos();

    expect(stubs.asked.at(-1)).toEqual(["", "videos", {}, "largest", { sizeSortWithoutTerm: true }]);
    expect(stubs.listOptions.at(-1)?.[1]).toEqual({ skip: true });
    expect(stubs.dayOptions.at(-1)?.[1]).toEqual({ skip: true });
    expect(props.photoset).toEqual([video]);
    expect(props.idx2hash).toEqual([video]);
    expect(props.sort).toBe("largest");
    expect(props.sortTotal).toBe(4200);
    expect(props.updateGroups).toBeUndefined();
    expect(props.headerActions).toBeDefined();
  });

  it("offers no sort while there are no videos", async () => {
    const props = await renderVideos();

    expect(props.photoset).toEqual([]);
    expect(props.headerActions).toBeUndefined();
  });
});
