/**
 * Leaving an album shared with you (#2210): one request, a toast once the server agreed, a fresh
 * "Shared with me" list, and the album's own grid marked stale without refetching it while its
 * page is still on screen (that would flash "Album not found" before the page leaves).
 */
import { albumKeys, photoGridKeys } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import { useLeaveSharedAlbumMutation } from "./useLeaveSharedAlbumMutation";

const stubs = vi.hoisted(() => ({
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  leaveAlbum: vi.fn<(title: string) => void>(),
}));

vi.mock("../../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api")>()),
  apiClient: { post: (...args: Parameters<typeof stubs.post>) => stubs.post(...args) },
}));
vi.mock("../../../service/notifications", () => ({ notification: { leaveAlbum: stubs.leaveAlbum } }));

let client: QueryClient;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});

async function leave() {
  const invalidate = vi.spyOn(client, "invalidateQueries");
  let mutate: ReturnType<typeof useLeaveSharedAlbumMutation>["mutateAsync"] | undefined;
  function Harness() {
    mutate = useLeaveSharedAlbumMutation().mutateAsync;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    );
  });
  let failure: unknown;
  await act(async () => {
    await mutate?.({ id: "7", title: "Lisbon 2026" }).catch((error: unknown) => {
      failure = error;
    });
  });
  await act(async () => root.unmount());
  return { calls: invalidate.mock.calls.map(([filters]) => filters), failure };
}

describe("useLeaveSharedAlbumMutation", () => {
  it("leaves, says so, and refreshes Shared with me", async () => {
    stubs.post.mockResolvedValue(undefined);

    const { calls } = await leave();

    expect(stubs.post).toHaveBeenCalledWith("/useralbum/leave/", { album_id: "7" });
    expect(stubs.leaveAlbum).toHaveBeenCalledWith("Lisbon 2026");
    expect(calls).toEqual(
      expect.arrayContaining([
        { queryKey: albumKeys.sharedWithMe() },
        { queryKey: photoGridKeys.userAlbum("7"), refetchType: "none" },
      ])
    );
  });

  it("neither toasts nor refreshes when the server refused", async () => {
    stubs.post.mockRejectedValue(new ApiError("Not found", 404));

    const { calls, failure } = await leave();

    expect(failure).toBeInstanceOf(ApiError);
    expect(stubs.leaveAlbum).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
