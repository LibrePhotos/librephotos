/**
 * The Sharing overview reads my public photos from their own query (#2686), so making a photo public
 * or private must mark it stale next to the public day lists.
 */
import { photoGridKeys } from "@librephotos/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { queryClient } from "../../api";
import { useSetPhotosPublicMutation } from "./useSetPhotosPublicMutation";

const stubs = vi.hoisted(() => ({
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
}));

vi.mock("../../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api")>()),
  apiClient: { post: (...args: Parameters<typeof stubs.post>) => stubs.post(...args) },
}));
vi.mock("../../../service/notifications", () => ({ notification: { togglePhotosPublic: () => {} } }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => queryClient.clear());

describe("useSetPhotosPublicMutation", () => {
  it("marks the Sharing overview's public photos stale", async () => {
    stubs.post.mockResolvedValue({ status: true, updated_hashes: ["a"] });
    const myPublicPhotos = photoGridKeys.myPublicPhotos(6);
    queryClient.setQueryData(myPublicPhotos, { count: 0, next: null, previous: null, results: [] });

    let mutation: ReturnType<typeof useSetPhotosPublicMutation> | undefined;
    function Probe() {
      mutation = useSetPhotosPublicMutation();
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
    await act(async () => {
      await defined(mutation).mutateAsync({ image_hashes: ["a"], val_public: true });
    });
    await act(async () => root.unmount());

    expect(stubs.post).toHaveBeenCalledWith("/photosedit/makepublic/", expect.objectContaining({ val_public: true }));
    expect(queryClient.getQueryState(myPublicPhotos)?.isInvalidated).toBe(true);
  });
});
