/**
 * A rating or caption set through the metadata API now lands where the app
 * reads it (#2252): the photo's rating draws the grid star and the Favorites
 * list, the caption is searched and makes hashtag albums. So an edit must
 * refresh the photo grids and search, not only the metadata panel.
 */
import type { ApiClient, PhotoMetadataUpdate } from "@librephotos/api-client";
import { photoKeys } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { useBulkUpdateMetadataMutation, useUpdatePhotoMetadataMutation } from "./usePhotoMetadataMutations";

const mocks = vi.hoisted(() => ({
  updatePhotoMetadata: vi.fn<(client: ApiClient, photoId: string, updates: PhotoMetadataUpdate) => Promise<unknown>>(),
  bulkUpdateMetadata:
    vi.fn<(client: ApiClient, photoIds: string[], updates: PhotoMetadataUpdate) => Promise<unknown>>(),
  invalidatePhotoLists: vi.fn<() => void>(),
}));

vi.mock("@librephotos/api-client", async importOriginal => {
  const original = await importOriginal<typeof import("@librephotos/api-client")>();
  return {
    ...original,
    endpoints: {
      ...original.endpoints,
      updatePhotoMetadata: mocks.updatePhotoMetadata,
      bulkUpdatePhotoMetadata: mocks.bulkUpdateMetadata,
    },
  };
});
vi.mock("../invalidatePhotoLists", () => ({ invalidatePhotoLists: mocks.invalidatePhotoLists }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mocks.updatePhotoMetadata.mockReset().mockResolvedValue({});
  mocks.bulkUpdateMetadata.mockReset().mockResolvedValue({ updated_count: 2, message: "" });
  mocks.invalidatePhotoLists.mockClear();
});

async function withHook<T>(useHook: () => T, run: (hook: T) => Promise<unknown>) {
  let hook: T | undefined;
  function Probe() {
    hook = useHook();
    return null;
  }
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await run(defined(hook));
  });
  await act(async () => {
    root.unmount();
  });
  return invalidate.mock.calls.map(([filters]) => filters?.queryKey);
}

describe("useUpdatePhotoMetadataMutation", () => {
  it.each<[string, PhotoMetadataUpdate]>([
    ["rating", { rating: 5 }],
    ["caption", { caption: "Grandma's 80th" }],
  ])("refreshes the photo grids, search and details after a %s edit", async (_field, updates) => {
    const keys = await withHook(useUpdatePhotoMetadataMutation, hook => hook.mutateAsync({ photoId: "abc", updates }));

    expect(mocks.updatePhotoMetadata).toHaveBeenCalledWith(expect.anything(), "abc", updates);
    // Every photo grid, search included (see invalidatePhotoLists).
    expect(mocks.invalidatePhotoLists).toHaveBeenCalledTimes(1);
    expect(keys).toContainEqual(photoKeys.metadata("abc"));
    expect(keys).toContainEqual(photoKeys.details());
  });
});

describe("useBulkUpdateMetadataMutation", () => {
  it("refreshes every edited photo and the photo grids", async () => {
    const keys = await withHook(useBulkUpdateMetadataMutation, hook =>
      hook.mutateAsync({ photoIds: ["a", "b"], updates: { rating: 4 } })
    );

    expect(mocks.invalidatePhotoLists).toHaveBeenCalledTimes(1);
    expect(keys).toContainEqual(photoKeys.metadata("a"));
    expect(keys).toContainEqual(photoKeys.metadata("b"));
    expect(keys).toContainEqual(photoKeys.details());
  });
});
