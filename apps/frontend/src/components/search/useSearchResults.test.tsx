/**
 * The search results with filters (#2259, #329): the filters from the URL go to the search,
 * a filter-only search selects all on the server with the same filters and every stacked photo,
 * a search with words selects the listed photos, and a filter the server refuses is explained
 * with a way out instead of a failed list.
 */
import { ApiError, type MediaType, type SearchFilters } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import type { PhotoListView } from "../photolist/PhotoListView";
import { useSearchResults } from "./useSearchResults";

type PhotoListViewProps = React.ComponentProps<typeof PhotoListView>;
type SearchUpdater = (prev: Record<string, unknown>) => Record<string, unknown>;

const stubs = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  navigate: vi.fn<(options: { to: string; search: SearchUpdater }) => Promise<void>>(),
  asked: [] as [string, MediaType | undefined, SearchFilters | undefined][],
  error: null as Error | null,
  props: undefined as PhotoListViewProps | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  // As the router does: the hooks read their params through `select`.
  useSearch: ({ select }: { select: (search: Record<string, unknown>) => unknown }) => select(stubs.search),
  useNavigate: () => stubs.navigate,
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({
    data: { semantic_search_topk: 0, rating_mode: "favorite", favorite_min_rating: 4 },
  }),
}));
vi.mock("../../api_client/user/hooks", () => ({
  useCurrentUserSelfDetailsQuery: () => ({
    data: { semantic_search_topk: 0, rating_mode: "favorite", favorite_min_rating: 4 },
  }),
}));
vi.mock("../../api_client/search/hooks", () => ({
  useSearchPhotosQuery: (term: string, mediaType?: MediaType, filters?: SearchFilters) => {
    stubs.asked.push([term, mediaType, filters]);
    return {
      data: stubs.error ? undefined : { photosFlat: [], photosGroupedByDate: [] },
      isPending: false,
      isError: stubs.error !== null,
      isFetching: false,
      error: stubs.error,
      refetch: () => Promise.resolve(),
    };
  },
}));

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

afterEach(() => {
  stubs.search = {};
  stubs.asked = [];
  stubs.error = null;
  stubs.props = undefined;
  stubs.navigate.mockReset();
});

// What a search route does with the hook.
function SearchPage({ term }: Readonly<{ term: string }>) {
  stubs.props = useSearchResults(term);
  return null;
}

async function renderView(term: string) {
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<SearchPage term={term} />);
  });
  return { props: defined(stubs.props), unmount: () => act(async () => root.unmount()) };
}

describe("SearchResultsView", () => {
  it("searches by filters alone and selects all of them on the server", async () => {
    stubs.search = { media: "photos", camera: "X-T5", person: [3, 7], iso_min: "bad" };
    const { props, unmount } = await renderView("");

    expect(stubs.asked.at(-1)).toEqual(["", "photos", { camera: "X-T5", person: [3, 7] }]);
    expect(props.title).toBe("Filtered photos");
    expect(props.photosetQuery).toEqual({
      camera: "X-T5",
      person: [3, 7],
      photo: true,
      show_all_stack_photos: true,
    });
    expect(props.emptyStateConfig?.title).toBe("No photos match these filters");
    await unmount();
  });

  it("selects the listed photos of a search with words", async () => {
    stubs.search = { camera: "X-T5" };
    const { props, unmount } = await renderView("beach");

    expect(props.title).toBe('Results for "beach"');
    expect(props.photosetQuery).toBeUndefined();
    expect(props.loading).toBe(false);
    await unmount();
  });

  it("asks for filters on the filter-only page without any", async () => {
    const { props, unmount } = await renderView("");

    expect(props.emptyStateConfig?.title).toBe("Choose filters");
    expect(props.loading).toBe(false);
    await unmount();
  });

  it("explains a refused filter and clears the filters, keeping the media type", async () => {
    stubs.search = { media: "videos", person: [99] };
    stubs.error = new ApiError(400, "/photos/searchlist/", "Bad Request", undefined, "Unknown person: 99.");
    const { props, unmount } = await renderView("");

    expect(props.error).toBeUndefined();
    expect(props.emptyStateConfig?.title).toBe("Search filter not applied");
    expect(props.emptyStateConfig?.description).toContain("Unknown person: 99.");

    await act(async () => defined(props.emptyStateConfig?.onAction)());
    const options = defined(stubs.navigate.mock.calls.at(-1))[0];
    expect(options.to).toBe(".");
    const next = options.search({ media: "videos", person: [99] });
    expect(defined(next).media).toBe("videos");
    expect(defined(next).person).toBeUndefined();
    await unmount();
  });

  it("shows any other failure as a failed list", async () => {
    stubs.search = { camera: "X-T5" };
    stubs.error = new ApiError(500, "/photos/searchlist/", "Server Error");
    const { props, unmount } = await renderView("");

    expect(props.error).toBeDefined();
    await unmount();
  });
});
