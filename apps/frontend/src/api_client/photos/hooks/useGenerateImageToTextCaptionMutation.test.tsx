/**
 * "The captioning model is downloading, try again" used to be a 200 with
 * "status": false and a reason. It is a 503 with code model_downloading now,
 * so the hook tells the user from its error path and does not refresh the
 * photo as if a caption had been written (#2325).
 */
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";

const stubs = await vi.hoisted(async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const { ApiError } = await import("@librephotos/api-client");
  return {
    ApiError,
    post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
    captionModelDownloading: vi.fn<() => void>(),
    queryClient: new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
  };
});

vi.mock("../../api", () => ({
  ApiError: stubs.ApiError,
  fetchClient: { post: stubs.post },
  queryClient: stubs.queryClient,
}));
vi.mock("../../../service/notifications", () => ({
  notification: { captionModelDownloading: stubs.captionModelDownloading },
}));

const { useGenerateImageToTextCaptionMutation } = await import("./useGenerateImageToTextCaptionMutation");

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

async function generate(id: string) {
  let mutate: ReturnType<typeof useGenerateImageToTextCaptionMutation>["mutate"] | undefined;
  function Probe() {
    mutate = useGenerateImageToTextCaptionMutation().mutate;
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
  await act(async () => {
    defined(mutate)({ id });
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  });
  await act(async () => root.unmount());
}

const failure = (status: number, code: string) =>
  new stubs.ApiError(status, "/photosedit/generateim2txt/", `API error: ${status}`, {
    errors: [{ field: "detail", message: "Try again in a few minutes.", code }],
  });

describe("useGenerateImageToTextCaptionMutation", () => {
  const invalidate = vi.spyOn(stubs.queryClient, "invalidateQueries");

  beforeEach(() => {
    stubs.post.mockReset();
    stubs.captionModelDownloading.mockClear();
    invalidate.mockClear();
  });

  it("refreshes the photo once the caption is written", async () => {
    stubs.post.mockResolvedValueOnce({ status: true });

    await generate("abc");

    expect(stubs.post).toHaveBeenCalledWith("/photosedit/generateim2txt/", { image_hash: "abc" });
    expect(invalidate).toHaveBeenCalled();
    expect(stubs.captionModelDownloading).not.toHaveBeenCalled();
  });

  it("says the model is downloading on a 503 with that code", async () => {
    stubs.post.mockRejectedValueOnce(failure(503, "model_downloading"));

    await generate("abc");

    expect(stubs.captionModelDownloading).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("stays quiet for other failures, which toast elsewhere", async () => {
    stubs.post.mockRejectedValueOnce(failure(500, "caption_failed"));

    await generate("abc");

    expect(stubs.captionModelDownloading).not.toHaveBeenCalled();
  });
});
