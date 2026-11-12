/** The photo edit hooks: the edit's query, and what a save and a delete refresh. */
import { photoGridKeys, photoKeys, type PhotoEditUpdate } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";

const PHOTO_ID = "4f1c2d3e-0000-4000-8000-000000000001";
const EDIT = {
  photo_id: PHOTO_ID,
  settings: { version: 1, light: { exposure: 0.35 } },
  history: [],
  history_cursor: -1,
  version: 3,
  rendition: "pending",
  updated_at: "2026-11-12T09:30:00Z",
};

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  request: vi.fn<(endpoint: string, options?: unknown) => Promise<unknown>>(),
  delete: vi.fn<(endpoint: string) => Promise<unknown>>(),
  getBlob: vi.fn<(endpoint: string) => Promise<Blob>>(),
}));

vi.mock("../api", () => ({ apiClient: stubs }));

const { fetchEditSource, useDeletePhotoEditMutation, usePhotoEditQuery, useSavePhotoEditMutation } =
  await import("./photoEdits");

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function renderHook<T>(hook: () => T, client = new QueryClient()) {
  const result: { current?: T } = {};
  function Probe() {
    result.current = hook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  });
  return { client, result, unmount: () => act(async () => root.unmount()) };
}

const invalidated = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map(([filters]) =>
    typeof filters === "object" && filters !== null && "queryKey" in filters ? filters.queryKey : null
  );

describe("photo edit hooks", () => {
  it("reads a photo's edit by its id, and waits without one", async () => {
    stubs.get.mockResolvedValue(EDIT);
    const { client, unmount } = await renderHook(() => usePhotoEditQuery(PHOTO_ID));
    await act(async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    });
    await unmount();
    expect(stubs.get).toHaveBeenCalledWith(`/photos/${PHOTO_ID}/edit/`);
    expect(client.getQueryData(photoKeys.edit(PHOTO_ID))).toEqual(EDIT);

    stubs.get.mockClear();
    const waiting = await renderHook(() => usePhotoEditQuery(undefined));
    await waiting.unmount();
    expect(stubs.get).not.toHaveBeenCalled();
  });

  it("saves with PUT, caches the answer and refreshes the details and every grid", async () => {
    stubs.request.mockResolvedValue({ ...EDIT, version: 4 });
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result, unmount } = await renderHook(() => useSavePhotoEditMutation(), client);
    const edit: PhotoEditUpdate = {
      settings: { version: 1, light: { exposure: 0.35 } },
      history: [],
      history_cursor: -1,
    };
    await act(async () => {
      await defined(result.current).mutateAsync({ photoId: PHOTO_ID, edit });
    });
    await unmount();
    expect(stubs.request).toHaveBeenCalledWith(`/photos/${PHOTO_ID}/edit/`, { method: "PUT", body: edit });
    expect(client.getQueryData(photoKeys.edit(PHOTO_ID))).toMatchObject({ version: 4 });
    expect(invalidated(invalidate)).toEqual([photoKeys.details(), photoGridKeys.all]);
  });

  it("deletes and refreshes the edit, the details and every grid", async () => {
    stubs.delete.mockResolvedValue(null);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result, unmount } = await renderHook(() => useDeletePhotoEditMutation({ reportsErrors: true }), client);
    await act(async () => {
      await defined(result.current).mutateAsync(PHOTO_ID);
    });
    await unmount();
    expect(stubs.delete).toHaveBeenCalledWith(`/photos/${PHOTO_ID}/edit/`);
    expect(invalidated(invalidate)).toEqual([photoKeys.edit(PHOTO_ID), photoKeys.details(), photoGridKeys.all]);
  });

  it("fetches the edit source as bytes", async () => {
    stubs.getBlob.mockResolvedValue(new Blob([new Uint8Array([76, 80, 69, 83])]));
    const bytes = new Uint8Array(await fetchEditSource(PHOTO_ID));
    expect([...bytes]).toEqual([76, 80, 69, 83]);
    expect(stubs.getBlob).toHaveBeenCalledWith(`/photos/${PHOTO_ID}/edit/source/`);
  });
});
