/**
 * The photo order (#2712) is the signed-in user's `photo_order`: newest first for a visitor and
 * from a server that does not send it, and not "ready" while the user is still loading, so a list
 * never loads in the other order first. Changing it updates the cached user at once and saves only
 * that field; a failed save puts the old order back and says so.
 */
import { ApiError, userKeys, type PhotoOrder } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  patch: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  saveFailed: vi.fn<(message: string | null) => void>(),
  auth: { data: undefined as { access: { user_id: number } | null } | undefined, isPending: false },
}));

vi.mock("../../api", () => ({ apiClient: { get: stubs.get, patch: stubs.patch } }));
vi.mock("../../auth/hooks", () => ({ useAccessToken: () => stubs.auth }));
vi.mock("../../../service/notifications", () => ({ notification: { saveFailed: stubs.saveFailed } }));

const { usePhotoOrder, usePhotoOrderSelect, useSetPhotoOrderMutation } = await import("./usePhotoOrder");

const user = (photoOrder?: PhotoOrder) => ({
  id: 7,
  username: "alice",
  email: "",
  confidence: 0.1,
  confidence_person: 0.9,
  transcode_videos: false,
  semantic_search_topk: 0,
  first_name: "",
  public_photo_samples: [],
  last_name: "",
  public_photo_count: 0,
  date_joined: "2026-01-01T00:00:00Z",
  photo_count: 0,
  favorite_min_rating: 4,
  image_scale: 1,
  save_metadata_to_disk: "OFF",
  datetime_rules: "[]",
  default_timezone: "UTC",
  public_sharing: false,
  min_cluster_size: 0,
  min_samples: 1,
  cluster_selection_epsilon: 0.05,
  llm_settings: null,
  ...(photoOrder ? { photo_order: photoOrder } : {}),
});

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.clearAllMocks();
  stubs.auth = { data: undefined, isPending: false };
});

async function render<T>(useHook: () => T, queryClient = new QueryClient()) {
  const result: { current?: T } = {};
  function Probe() {
    result.current = useHook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    );
  });
  return { result, queryClient };
}

describe("usePhotoOrder", () => {
  it("is newest first and ready for a visitor", async () => {
    stubs.auth = { data: { access: null }, isPending: false };
    const { result } = await render(usePhotoOrder);
    expect(result.current).toEqual({ order: "newest", ready: true });
    expect(stubs.get).not.toHaveBeenCalled();
  });

  it("is not ready while the token or the user is still loading", async () => {
    stubs.auth = { data: undefined, isPending: true };
    expect((await render(usePhotoOrder)).result.current?.ready).toBe(false);

    stubs.auth = { data: { access: { user_id: 7 } }, isPending: false };
    stubs.get.mockReturnValue(new Promise(() => {}));
    expect((await render(usePhotoOrder)).result.current?.ready).toBe(false);
  });

  // The user as the app has it cached once it loaded.
  function signedIn(photoOrder?: PhotoOrder) {
    stubs.auth = { data: { access: { user_id: 7 } }, isPending: false };
    stubs.get.mockResolvedValue(user(photoOrder));
    const queryClient = new QueryClient();
    queryClient.setQueryData(userKeys.selfDetail("7"), user(photoOrder));
    return queryClient;
  }

  it("is the user's order once loaded, newest first from a server that does not send it", async () => {
    expect((await render(usePhotoOrder, signedIn("oldest"))).result.current).toEqual({ order: "oldest", ready: true });
    expect((await render(usePhotoOrder, signedIn())).result.current).toEqual({ order: "newest", ready: true });
  });

  it("gives a select that applies the order", async () => {
    const reorder = (data: string[], order: PhotoOrder) => (order === "oldest" ? data.toReversed() : data);
    const { result } = await render(() => usePhotoOrderSelect(reorder), signedIn("oldest"));
    expect(defined(result.current).select(["b", "a"])).toEqual(["a", "b"]);
  });
});

describe("useSetPhotoOrderMutation", () => {
  async function setOrder(order: PhotoOrder) {
    const queryClient = new QueryClient();
    queryClient.setQueryData(userKeys.selfDetail("7"), user("newest"));
    const { result } = await render(useSetPhotoOrderMutation, queryClient);
    const pending = defined(result.current).mutateAsync({ userId: 7, order });
    return { queryClient, pending };
  }

  it("switches the cached user at once and saves only photo_order", async () => {
    let resolve: (value: unknown) => void = () => {};
    stubs.patch.mockReturnValue(new Promise(r => (resolve = r)));
    const { queryClient, pending } = await setOrder("oldest");
    await act(async () => {});
    expect(queryClient.getQueryData(userKeys.selfDetail("7"))).toHaveProperty("photo_order", "oldest");
    expect(stubs.patch).toHaveBeenCalledWith("/user/7/", { photo_order: "oldest" });
    await act(async () => {
      resolve(user("oldest"));
      await pending;
    });
    expect(stubs.saveFailed).not.toHaveBeenCalled();
  });

  it("puts the old order back and says so when the save fails", async () => {
    stubs.patch.mockRejectedValue(new ApiError(400, "/user/7/", "refused", undefined, "No."));
    const { queryClient, pending } = await setOrder("oldest");
    await act(async () => {
      await pending.catch(() => {});
    });
    expect(queryClient.getQueryData(userKeys.selfDetail("7"))).toHaveProperty("photo_order", "newest");
    expect(stubs.saveFailed).toHaveBeenCalledWith("No.");
  });
});
