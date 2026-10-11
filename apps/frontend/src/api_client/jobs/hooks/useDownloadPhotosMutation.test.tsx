/**
 * The zip archive is fetched from /media/zip/<uuid>, which the backend serves
 * in every deployment (it appends the user id itself). The download stays
 * pending until the archive is saved, a failed status check or job stops the
 * poll with one failure toast, and cancelPhotoDownloads() stops it without one.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { POLL_ARCHIVE_MS } from "../../polling";
import { cancelPhotoDownloads, useDownloadPhotosMutation } from "./useDownloadPhotosMutation";

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
let logSpy: MockInstance<typeof console.log>;
let errorSpy: MockInstance<typeof console.error>;

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
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", fetchMock);
  window.URL.createObjectURL = vi.fn(() => "blob:zip");
  window.URL.revokeObjectURL = vi.fn<(url: string) => void>();
  fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(["zip"]) });
  stubs.post.mockResolvedValue({ url: UUID, job_id: "job-1" });
  stubs.delete.mockResolvedValue({});
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <Harness />
      </QueryClientProvider>
    );
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Starts a download and returns its promise, with a flag that says whether it has settled. */
function startDownload() {
  const outcome = { settled: false, error: undefined as unknown };
  const promise = mutate({ image_hashes: ["a"], userId: 7 }).then(
    () => {
      outcome.settled = true;
    },
    (err: unknown) => {
      outcome.settled = true;
      outcome.error = err;
    }
  );
  return { promise, outcome };
}

describe("useDownloadPhotosMutation", () => {
  it("stays pending until the archive is saved, then deletes the zip and reports completion", async () => {
    stubs.get.mockResolvedValueOnce({ status: "PENDING" }).mockResolvedValueOnce({ status: "SUCCESS" });
    let finishBlob: ((blob: Blob) => void) | undefined;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: () =>
        new Promise<Blob>(resolve => {
          finishBlob = resolve;
        }),
    });
    const { promise, outcome } = startDownload();

    await advance(POLL_ARCHIVE_MS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.settled).toBe(false);

    await advance(POLL_ARCHIVE_MS);
    expect(fetchMock).toHaveBeenCalledWith(`/media/zip/${UUID}`, expect.objectContaining({ credentials: "include" }));
    expect(outcome.settled).toBe(false);

    await act(async () => {
      finishBlob?.(new Blob(["zip"]));
      await promise;
    });
    expect(outcome.settled).toBe(true);
    expect(stubs.delete).toHaveBeenCalledWith(`/delete/zip/${UUID}`);
    expect(stubs.downloadCompleted).toHaveBeenCalledTimes(1);
    expect(stubs.downloadFailed).not.toHaveBeenCalled();
  });

  it("reports a failure to start the archive job, which used to pass silently", async () => {
    stubs.post.mockRejectedValue(new Error("500"));
    const { promise, outcome } = startDownload();
    await promise;

    expect(outcome.error).toBeInstanceOf(Error);
    expect(stubs.get).not.toHaveBeenCalled();
    expect(stubs.downloadFailed).toHaveBeenCalledTimes(1);
  });

  it("logs nothing to the console on success or failure", async () => {
    stubs.get.mockRejectedValue(new Error("404"));
    const { promise } = startDownload();
    await advance(POLL_ARCHIVE_MS);
    await promise;

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("stops polling after a failed status check, with one failure toast", async () => {
    stubs.get.mockRejectedValue(new Error("404"));
    const { promise, outcome } = startDownload();

    await advance(POLL_ARCHIVE_MS);
    await advance(POLL_ARCHIVE_MS * 2);
    await promise;

    expect(stubs.get).toHaveBeenCalledTimes(1);
    expect(stubs.downloadFailed).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.error).toBeInstanceOf(Error);
  });

  it("stops polling when the archive job failed, with one failure toast", async () => {
    stubs.get.mockResolvedValue({ status: "FAILURE" });
    const { promise, outcome } = startDownload();

    await advance(POLL_ARCHIVE_MS);
    await advance(POLL_ARCHIVE_MS);
    await promise;

    expect(stubs.get).toHaveBeenCalledTimes(1);
    expect(stubs.downloadFailed).toHaveBeenCalledTimes(1);
    expect(outcome.settled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancelPhotoDownloads stops polling and saves nothing, without a failure toast", async () => {
    stubs.get.mockResolvedValue({ status: "PENDING" });
    const { promise, outcome } = startDownload();

    await advance(POLL_ARCHIVE_MS);
    expect(stubs.get).toHaveBeenCalledTimes(1);

    act(() => cancelPhotoDownloads());
    await promise;
    await advance(POLL_ARCHIVE_MS * 5);

    expect(outcome.settled).toBe(true);
    expect(stubs.get).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stubs.downloadFailed).not.toHaveBeenCalled();
    expect(stubs.downloadCompleted).not.toHaveBeenCalled();
  });

  it("cancelPhotoDownloads with nothing running does nothing", () => {
    expect(() => cancelPhotoDownloads()).not.toThrow();
  });
});
