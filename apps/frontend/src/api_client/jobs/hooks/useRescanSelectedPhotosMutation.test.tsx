/**
 * Rescan selected photos (#2214): POSTs their ids, says how many photos it reads again, follows a
 * scan that is already running, and says why it did not start (the server's words).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { settledMutationWith } from "../../../util/hookHarness.test-utils";
import { useRescanSelectedPhotosMutation } from "./useRescanSelectedPhotosMutation";

const toasts = vi.hoisted(() => ({
  rescanPhotosStarted: vi.fn<(count: number) => void>(),
  rescanPhotosFailed: vi.fn<(message: string) => void>(),
  jobAlreadyRunning: vi.fn<() => void>(),
}));
// Only the toasts these requests can show; the client's own (serverError) stays quiet.
vi.mock("../../../service/notifications", () => ({ notification: { ...toasts, serverError: () => {} } }));

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useRescanSelectedPhotosMutation", () => {
  it("POSTs the photo ids and says how many photos are read again", async () => {
    const fetchMock = respond(200, { status: true, job_id: "j1", job_ids: ["j1"], photo_count: 2, file_count: 3 });

    await settledMutationWith(useRescanSelectedPhotosMutation, ["p1", "p2"]);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/photos/rescan/");
    expect(init?.body).toBe(JSON.stringify({ photo_ids: ["p1", "p2"] }));
    expect(toasts.rescanPhotosStarted).toHaveBeenCalledWith(2);
  });

  it("follows a scan that is already running", async () => {
    respond(409, { errors: [{ code: "job_already_running", message: "Already running", job_id: "j0" }] });

    const result = await settledMutationWith(useRescanSelectedPhotosMutation, ["p1"]);

    expect(result.isSuccess).toBe(true);
    expect(toasts.jobAlreadyRunning).toHaveBeenCalledTimes(1);
    expect(toasts.rescanPhotosStarted).not.toHaveBeenCalled();
  });

  it("says why the rescan did not start", async () => {
    const message = "None of these photos has a file in your library any more.";
    respond(400, { errors: [{ field: "detail", message, code: "no_files_to_scan" }] });

    const result = await settledMutationWith(useRescanSelectedPhotosMutation, ["p1"]);

    expect(result.isError).toBe(true);
    expect(toasts.rescanPhotosFailed).toHaveBeenCalledWith(message);
  });
});
