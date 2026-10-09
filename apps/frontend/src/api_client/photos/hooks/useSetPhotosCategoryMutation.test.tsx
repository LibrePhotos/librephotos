/**
 * A failed category change says so (issue #2130). The toast is at hook level,
 * so it also reports an Undo fired after the lightbox closed.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";

const stubs = await vi.hoisted(async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
    requestFailed: vi.fn<(title: string, message: string) => void>(),
    setPhotosCategory: vi.fn<(numberOfPhotos: number, category: "photo" | "screenshot" | "document") => void>(),
    queryClient: new QueryClient(),
  };
});

vi.mock("../../api", () => ({ fetchClient: { post: stubs.post }, queryClient: stubs.queryClient }));
vi.mock("../../../service/notifications", () => ({
  notification: { requestFailed: stubs.requestFailed, setPhotosCategory: stubs.setPhotosCategory },
}));

const { useSetPhotosCategoryMutation } = await import("./useSetPhotosCategoryMutation");

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe("useSetPhotosCategoryMutation", () => {
  it("reports a failure even after the caller unmounted", async () => {
    stubs.post.mockRejectedValueOnce(new Error("500"));
    let mutate: ReturnType<typeof useSetPhotosCategoryMutation>["mutate"] | undefined;
    function Probe() {
      mutate = useSetPhotosCategoryMutation().mutate;
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(
        <QueryClientProvider client={stubs.queryClient}>
          <Probe />
        </QueryClientProvider>
      );
    });
    await act(async () => root.unmount());

    await act(async () => {
      defined(mutate)({ image_hashes: ["abc"], category: "auto", notify: false });
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    });
    expect(stubs.post).toHaveBeenCalledWith("/photosedit/category/", { image_hashes: ["abc"], category: "auto" });
    expect(stubs.requestFailed).toHaveBeenCalledTimes(1);
  });
});
