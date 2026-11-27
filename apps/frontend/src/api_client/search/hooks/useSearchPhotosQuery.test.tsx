/**
 * The search endpoint answers in one of two shapes, picked by the user's
 * semantic_search_topk setting: a flat list for semantic search, date groups
 * otherwise. The query used to start before the user had loaded (a hard load
 * of /search/<q>), so a semantic user's flat list was parsed as date groups and
 * popped a "Failed to parse search photos ... report this on GitHub" toast.
 */
import { ApiError, ResponseParseError } from "@librephotos/api-client";
import type { MediaType, PhotoOrder, SearchFilters, SearchSort } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { useSearchPhotosQuery } from "./useSearchPhotosQuery";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  user: undefined as { semantic_search_topk: number } | undefined,
  userFailed: false,
  photoOrder: { order: "newest", ready: true } as { order: PhotoOrder; ready: boolean },
}));

vi.mock("../../api", () => ({ apiClient: { get: stubs.get } }));
vi.mock("../../user/hooks/usePhotoOrder", () => ({ usePhotoOrder: () => stubs.photoOrder }));
vi.mock("../../user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.user, isError: stubs.userFailed }),
}));

const pigPhoto = {
  id: "11111111-1111-1111-1111-111111111111",
  image_hash: "p1",
  aspectRatio: 1,
  type: "image",
  rating: 0,
  url: "p1",
};

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
let result: ReturnType<typeof useSearchPhotosQuery>;
let args: {
  term: string;
  mediaType?: MediaType;
  filters?: SearchFilters;
  sort?: SearchSort;
  sizeSortWithoutTerm?: boolean;
} = { term: "beach" };

function Probe() {
  result = useSearchPhotosQuery(args.term, args.mediaType, args.filters, args.sort, {
    sizeSortWithoutTerm: args.sizeSortWithoutTerm,
  });
  return null;
}

async function render(client: QueryClient) {
  await act(async () => {
    defined(root).render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  });
}

async function settle(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  }
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  stubs.get.mockReset();
  stubs.user = undefined;
  stubs.userFailed = false;
  stubs.photoOrder = { order: "newest", ready: true };
  args = { term: "beach" };
});

describe("useSearchPhotosQuery", () => {
  it("waits for the user, then parses a semantic user's flat result", async () => {
    stubs.get.mockResolvedValue({ results: [pigPhoto] });
    container = document.createElement("div");
    root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await render(client);
    expect(stubs.get).not.toHaveBeenCalled();
    // The search page shows its loader from isPending: isLoading is false while
    // the query waits, and the page flashed "No matching photos".
    expect(result.isPending).toBe(true);
    expect(result.isLoading).toBe(false);

    stubs.user = { semantic_search_topk: 10 };
    await render(client);
    await settle(() => result.isSuccess);

    expect(stubs.get).toHaveBeenCalledTimes(1);
    expect(stubs.get).toHaveBeenCalledWith("/photos/searchlist/?search=beach");
    expect(result.data?.photosFlat).toHaveLength(1);
  });

  it("still searches when the user cannot be loaded", async () => {
    // Waiting for a user that never comes left the page loading forever.
    stubs.userFailed = true;
    stubs.get.mockResolvedValue({ results: [{ date: "2024-04-02", location: "", items: [pigPhoto] }] });
    container = document.createElement("div");
    root = createRoot(container);

    await render(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await settle(() => result.isSuccess);

    expect(stubs.get).toHaveBeenCalledTimes(1);
    expect(result.data?.photosGroupedByDate).toHaveLength(1);
  });

  it("parses date groups for a user without semantic search", async () => {
    stubs.user = { semantic_search_topk: 0 };
    stubs.get.mockResolvedValue({ results: [{ date: "2024-04-02", location: "", items: [pigPhoto] }] });
    container = document.createElement("div");
    root = createRoot(container);

    await render(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await settle(() => result.isSuccess);

    expect(result.data?.photosGroupedByDate).toHaveLength(1);
    expect(result.data?.photosFlat).toHaveLength(1);
  });

  // The undated group comes as "No timestamp" today and as null, like every
  // other grouped list, once the server switches; a null date failed the whole
  // search with a parse toast.
  it.each([["No timestamp"], [null]])("parses the undated group with date %j", async date => {
    stubs.user = { semantic_search_topk: 0 };
    stubs.get.mockResolvedValue({
      results: [
        { date: "2024-04-02", location: "", items: [pigPhoto] },
        { date, location: "", items: [{ ...pigPhoto, id: "22222222-2222-2222-2222-222222222222" }] },
      ],
    });
    container = document.createElement("div");
    root = createRoot(container);

    await render(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await settle(() => result.isSuccess || result.isError);

    expect(result.isSuccess).toBe(true);
    expect(result.data?.photosGroupedByDate[1]?.date).toBe(date);
    expect(result.data?.photosFlat).toHaveLength(2);
  });

  // A mismatch fails the query with the error the QueryClient reports (api.ts notifyParseError).
  it("fails on a response that does not match the schema", async () => {
    stubs.user = { semantic_search_topk: 0 };
    stubs.get.mockResolvedValue({ results: [{ date: 20240402, location: "", items: [pigPhoto] }] });
    container = document.createElement("div");
    root = createRoot(container);

    await render(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await settle(() => result.isError);

    expect(result.error).toBeInstanceOf(ResponseParseError);
  });

  // #2259, #329: the structured filters go to the server under their own names, a list as a
  // repeated key, and a search by filters alone needs no words.
  it("sends the filters and the media type, with or without words", async () => {
    stubs.user = { semantic_search_topk: 0 };
    stubs.get.mockResolvedValue({ results: [] });
    args = { term: "", mediaType: "photos", filters: { camera: "X-T5", iso_min: 3200, person: [3, 7] } };
    container = document.createElement("div");
    root = createRoot(container);

    await render(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await settle(() => result.isSuccess);

    expect(stubs.get).toHaveBeenCalledWith("/photos/searchlist/?photo=true&camera=X-T5&iso_min=3200&person=3&person=7");
  });

  it("searches by a photo as a flat list, sending the sort, for a user without semantic search", async () => {
    stubs.user = { semantic_search_topk: 0 };
    stubs.get.mockResolvedValue({ results: [pigPhoto] });
    args = { term: "", filters: { similar_to: pigPhoto.id }, sort: "newest" };
    container = document.createElement("div");
    root = createRoot(container);

    await render(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await settle(() => result.isSuccess);

    expect(stubs.get).toHaveBeenCalledWith(`/photos/searchlist/?similar_to=${pigPhoto.id}&sort=newest`);
    expect(result.data?.photosFlat).toHaveLength(1);
  });

  it("asks nothing without words or filters", async () => {
    stubs.user = { semantic_search_topk: 0 };
    args = { term: "", filters: { camera: undefined } };
    container = document.createElement("div");
    root = createRoot(container);

    await render(new QueryClient());

    expect(stubs.get).not.toHaveBeenCalled();
    expect(result.fetchStatus).toBe("idle");
  });

  it("does not ask again after the server refused a filter", async () => {
    stubs.user = { semantic_search_topk: 0 };
    stubs.get.mockRejectedValue(new ApiError(400, "/photos/searchlist/", "Bad Request", undefined, "Unknown person"));
    args = { term: "", filters: { person: [99] } };
    container = document.createElement("div");
    root = createRoot(container);

    // The app's QueryClient retries once; a refused filter must not be retried.
    await render(new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } }));
    await settle(() => result.isError);

    expect(stubs.get).toHaveBeenCalledTimes(1);
  });

  it.each(["largest", "smallest"] as const)(
    "asks nothing for a %s sort alone unless the caller opts in",
    async sort => {
      stubs.user = { semantic_search_topk: 0 };
      args = { term: "", sort };
      container = document.createElement("div");
      root = createRoot(container);

      await render(new QueryClient());

      expect(stubs.get).not.toHaveBeenCalled();
      expect(result.fetchStatus).toBe("idle");
    }
  );

  it("searches by a size sort alone when the caller opts in and sends the sort", async () => {
    stubs.user = { semantic_search_topk: 0 };
    stubs.get.mockResolvedValue({ results: [{ ...pigPhoto, size: 42000 }], count: 1 });
    args = { term: "", mediaType: "videos", sort: "largest", sizeSortWithoutTerm: true };
    container = document.createElement("div");
    root = createRoot(container);

    await render(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await settle(() => result.isSuccess);

    expect(stubs.get).toHaveBeenCalledWith("/photos/searchlist/?video=true&sort=largest");
    expect(result.data?.photosFlat[0]?.size).toBe(42000);
    expect(result.data?.photosGroupedByDate).toEqual([]);
    expect(result.data?.count).toBe(1);
  });

  const oldestFirst = {
    results: [
      {
        date: "2024-05-01T09:00:00Z",
        location: "",
        items: [{ ...pigPhoto, id: "a1111111-1111-1111-1111-111111111111", image_hash: "a1" }],
      },
      {
        date: "2024-05-02T09:00:00Z",
        location: "",
        items: [
          { ...pigPhoto, id: "b1111111-1111-1111-1111-111111111111", image_hash: "b1" },
          { ...pigPhoto, id: "b2222222-2222-2222-2222-222222222222", image_hash: "b2" },
        ],
      },
    ],
  };

  async function searchedGroups() {
    container = document.createElement("div");
    root = createRoot(container);
    await render(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await settle(() => result.isSuccess);
    return {
      dates: result.data?.photosGroupedByDate.map(group => group.date),
      flat: result.data?.photosFlat.map(item => item.image_hash),
    };
  }

  it("keeps the oldest-first groups the server sorted as they came", async () => {
    stubs.user = { semantic_search_topk: 0 };
    stubs.get.mockResolvedValue(oldestFirst);
    args = { term: "beach", sort: "oldest" };

    const { dates, flat } = await searchedGroups();

    expect(stubs.get).toHaveBeenCalledWith("/photos/searchlist/?search=beach&sort=oldest");
    expect(dates).toEqual(["2024-05-01T09:00:00Z", "2024-05-02T09:00:00Z"]);
    expect(flat).toEqual(["a1", "b1", "b2"]);
  });

  it("asks the server for the user's photo order without a sort and keeps its groups", async () => {
    stubs.user = { semantic_search_topk: 0 };
    stubs.photoOrder = { order: "oldest", ready: true };
    stubs.get.mockResolvedValue(oldestFirst);
    args = { term: "beach" };

    const { dates, flat } = await searchedGroups();

    expect(stubs.get).toHaveBeenCalledWith("/photos/searchlist/?search=beach&sort=oldest");
    expect(dates).toEqual(["2024-05-01T09:00:00Z", "2024-05-02T09:00:00Z"]);
    expect(flat).toEqual(["a1", "b1", "b2"]);
  });

  it("keeps a newest sort out of the query for a user who reads oldest first", async () => {
    stubs.user = { semantic_search_topk: 0 };
    stubs.photoOrder = { order: "oldest", ready: true };
    stubs.get.mockResolvedValue({ results: [] });
    args = { term: "beach", sort: "newest" };

    await searchedGroups();

    expect(stubs.get).toHaveBeenCalledWith("/photos/searchlist/?search=beach");
  });
});
