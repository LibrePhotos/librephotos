/**
 * The zip archive is fetched from /media/zip/<uuid>, which the backend serves
 * in every deployment (it appends the user id itself). The old nginx-only
 * /api/downloads/<uuid><userId> route 404ed without the proxy, after the whole
 * archive had been built. The status poll must also stop on an error instead
 * of toasting every three seconds forever.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DOWNLOAD_POLL_INTERVAL_MS, useDownloadPhotosMutation } from "./useDownloadPhotosMutation";

const stubs = vi.hoisted(() => ({
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  delete: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  downloadFailed: vi.fn<() => void>(),
  downloadCompleted: vi.fn<() => void>(),
}));

vi.mock("../../api", () => ({
  fetchClient: { post: stubs.post, get: stubs.get, delete: stubs.delete },
}));
vi.mock("../../apiClient", () => ({ serverAddress: "" }));
vi.mock("../../../service/notifications", () => ({
  notification: {
    downloadStarting: () => {},
    downloadFailed: stubs.downloadFailed,
    downloadCompleted: stubs.downloadCompleted,
  },
}));

const UUID = "0b4f4c5e-6f1a-4c55-9d3e-8a7b6c5d4e3f";
let mutate: ReturnType<typeof useDownloadPhotosMutation>["mutateAsync"];

function Harness() {
  mutate = useDownloadPhotosMutation().mutateAsync;
  return null;
}

// Stands in for fetch: the hook reads only ok and blob() of the archive response.
const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "blob">>>();

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", fetchMock);
  window.URL.createObjectURL = vi.fn(() => "blob:zip");
  window.URL.revokeObjectURL = vi.fn<(url: string) => void>();
  fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(["zip"]) });
  stubs.post.mockResolvedValue({ url: UUID, job_id: "job-1" });
  stubs.delete.mockResolvedValue({});
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Harness />
      </QueryClientProvider>
    );
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function poll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DOWNLOAD_POLL_INTERVAL_MS);
  });
}

describe("useDownloadPhotosMutation", () => {
  it("downloads the archive from /media/zip/<uuid> once the job succeeds", async () => {
    stubs.get.mockResolvedValueOnce({ status: "PENDING" }).mockResolvedValueOnce({ status: "SUCCESS" });

    await act(async () => {
      await mutate({ image_hashes: ["a"], userId: 7 });
    });
    await poll();
    expect(fetchMock).not.toHaveBeenCalled();
    await poll();

    expect(fetchMock).toHaveBeenCalledWith(`/media/zip/${UUID}`, { credentials: "include" });
    expect(stubs.delete).toHaveBeenCalledWith(`/delete/zip/${UUID}`);
    expect(stubs.downloadCompleted).toHaveBeenCalledTimes(1);
  });

  it("stops polling after a failed status check", async () => {
    stubs.get.mockRejectedValue(new Error("404"));

    await act(async () => {
      await mutate({ image_hashes: ["a"], userId: 7 });
    });
    await poll();
    await poll();
    await poll();

    expect(stubs.get).toHaveBeenCalledTimes(1);
    expect(stubs.downloadFailed).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops polling when the archive job failed", async () => {
    stubs.get.mockResolvedValue({ status: "FAILURE" });

    await act(async () => {
      await mutate({ image_hashes: ["a"], userId: 7 });
    });
    await poll();
    await poll();

    expect(stubs.get).toHaveBeenCalledTimes(1);
    expect(stubs.downloadFailed).toHaveBeenCalledTimes(1);
  });
});
