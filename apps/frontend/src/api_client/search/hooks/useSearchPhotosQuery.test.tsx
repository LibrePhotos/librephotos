/**
 * The search endpoint answers in one of two shapes, picked by the user's
 * semantic_search_topk setting: a flat list for semantic search, date groups
 * otherwise. The query used to start before the user had loaded (a hard load
 * of /search/<q>), so a semantic user's flat list was parsed as date groups and
 * popped a "Failed to parse search photos ... report this on GitHub" toast.
 */
import { ApiError, ResponseParseError } from "@librephotos/api-client";
import type { MediaType, SearchFilters } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { tempPigPhoto } from "../../../util/util";
import { orderSearchResult, useSearchPhotosQuery } from "./useSearchPhotosQuery";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  user: undefined as { semantic_search_topk: number } | undefined,
  userFailed: false,
}));

vi.mock("../../api", () => ({ apiClient: { get: stubs.get } }));
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
let args: { term: string; mediaType?: MediaType; filters?: SearchFilters } = { term: "beach" };

function Probe() {
  result = useSearchPhotosQuery(args.term, args.mediaType, args.filters);
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
});

describe("orderSearchResult (#2712)", () => {
  const photo = (id: string) => ({ ...tempPigPhoto(id), image_hash: id, isTemp: false });
  const grouped = {
    photosGroupedByDate: [
      { date: "2024-05-02T09:00:00Z", location: "", items: [photo("b2"), photo("b1")] },
      { date: "2024-05-01T09:00:00Z", location: "", items: [photo("a1")] },
    ],
    photosFlat: [photo("b2"), photo("b1"), photo("a1")],
  };

  it("puts date groups oldest first, and the lightbox's flat list with them", () => {
    const ordered = orderSearchResult(grouped, "oldest");
    expect(ordered.photosGroupedByDate.map(group => group.date)).toEqual([
      "2024-05-01T09:00:00Z",
      "2024-05-02T09:00:00Z",
    ]);
    expect(ordered.photosFlat.map(item => item.id)).toEqual(["a1", "b1", "b2"]);
  });

  it("leaves newest first and a semantic result, ordered by relevance, as they came", () => {
    expect(orderSearchResult(grouped, "newest")).toBe(grouped);
    const semantic = { photosGroupedByDate: [], photosFlat: [photo("x"), photo("y")] };
    expect(orderSearchResult(semantic, "oldest")).toBe(semantic);
  });
});
