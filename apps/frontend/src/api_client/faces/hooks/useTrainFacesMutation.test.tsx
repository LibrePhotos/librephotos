/**
 * Face training that cannot be queued used to answer 200 with "status": false,
 * and this hook showed "training started" for it. The backend now answers 500
 * (code job_start_failed), so the failure takes the error path (#2325).
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
    trainFaces: vi.fn<() => void>(),
    trainFacesFailed: vi.fn<() => void>(),
    queryClient: new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
  };
});

vi.mock("../../api", () => ({ apiClient: { post: stubs.post }, queryClient: stubs.queryClient }));
vi.mock("../../../service/notifications", () => ({
  notification: { trainFaces: stubs.trainFaces, trainFacesFailed: stubs.trainFacesFailed },
}));

const { useTrainFacesMutation } = await import("./useTrainFacesMutation");

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

async function train() {
  let mutate: ReturnType<typeof useTrainFacesMutation>["mutate"] | undefined;
  function Probe() {
    mutate = useTrainFacesMutation().mutate;
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
    defined(mutate)();
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  });
  await act(async () => root.unmount());
}

describe("useTrainFacesMutation", () => {
  beforeEach(() => {
    stubs.post.mockReset();
    stubs.trainFaces.mockClear();
    stubs.trainFacesFailed.mockClear();
  });

  it("says training started when the job was queued", async () => {
    stubs.post.mockResolvedValueOnce({ status: true, job_id: "8a1c" });

    await train();

    expect(stubs.post).toHaveBeenCalledWith("/trainfaces", {});
    expect(stubs.trainFaces).toHaveBeenCalledTimes(1);
    expect(stubs.trainFacesFailed).not.toHaveBeenCalled();
  });

  it("reports a job that could not be queued as a failure", async () => {
    stubs.post.mockRejectedValueOnce(
      new stubs.ApiError(500, "/trainfaces", "API error: 500", {
        errors: [{ field: "detail", message: "Could not start the face training.", code: "job_start_failed" }],
      })
    );

    await train();

    expect(stubs.trainFacesFailed).toHaveBeenCalledTimes(1);
    expect(stubs.trainFaces).not.toHaveBeenCalled();
  });
});
