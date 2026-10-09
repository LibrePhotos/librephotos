/**
 * The search endpoint answers in one of two shapes, picked by the user's
 * semantic_search_topk setting: a flat list for semantic search, date groups
 * otherwise. The query used to start before the user had loaded (a hard load
 * of /search/<q>), so a semantic user's flat list was parsed as date groups and
 * popped a "Failed to parse search photos ... report this on GitHub" toast.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useSearchPhotosQuery } from "./useSearchPhotosQuery";

const stubs = vi.hoisted(() => ({
  get: vi.fn(),
  user: undefined as { semantic_search_topk: number } | undefined,
  userFailed: false,
  parseError: vi.fn(),
}));

vi.mock("../../api", () => ({ fetchClient: { get: stubs.get } }));
vi.mock("../../user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.user, isError: stubs.userFailed }),
}));
// parseWithNotification reports a schema mismatch through parseError.
vi.mock("../../../service/notifications", () => ({ notification: { parseError: stubs.parseError } }));

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

function Probe() {
  result = useSearchPhotosQuery("beach");
  return null;
}

async function render(client: QueryClient) {
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  });
}

async function settle(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  }
}

beforeAll(() => {
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  stubs.get.mockReset();
  stubs.parseError.mockReset();
  stubs.user = undefined;
  stubs.userFailed = false;
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
    expect(result.data?.photosFlat).toHaveLength(1);
    expect(stubs.parseError).not.toHaveBeenCalled();
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
    expect(stubs.parseError).not.toHaveBeenCalled();
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
    expect(result.data?.photosGroupedByDate[1].date).toBe(date);
    expect(result.data?.photosFlat).toHaveLength(2);
    expect(stubs.parseError).not.toHaveBeenCalled();
  });

  // Proves the not.toHaveBeenCalled() checks above watch the right toast.
  it("reports a response that does not match the schema", async () => {
    stubs.user = { semantic_search_topk: 0 };
    stubs.get.mockResolvedValue({ results: [{ date: 20240402, location: "", items: [pigPhoto] }] });
    container = document.createElement("div");
    root = createRoot(container);

    await render(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await settle(() => result.isError);

    expect(stubs.parseError).toHaveBeenCalledTimes(1);
  });
});
