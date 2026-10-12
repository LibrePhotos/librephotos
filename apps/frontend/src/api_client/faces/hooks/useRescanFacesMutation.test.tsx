/**
 * Rescanning faces used to be a GET from two components, next to an unused
 * query hook. The mutation POSTs (the backend's GET is deprecated), through the
 * API client, and shows its own toasts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { settledMutation } from "../../../util/hookHarness.test-utils";
import { useRescanFacesMutation } from "./useRescanFacesMutation";

const toasts = vi.hoisted(() => ({
  rescanFaces: vi.fn<() => void>(),
  rescanFacesFailed: vi.fn<() => void>(),
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

describe("useRescanFacesMutation", () => {
  it("POSTs /api/scanfaces and says the scan started", async () => {
    const fetchMock = respond(200, { status: true, job_id: "j1" });

    await settledMutation(useRescanFacesMutation);

    expect(fetchMock).toHaveBeenCalledWith("/api/scanfaces", expect.objectContaining({ method: "POST" }));
    expect(toasts.rescanFaces).toHaveBeenCalledTimes(1);
    expect(toasts.rescanFacesFailed).not.toHaveBeenCalled();
  });

  it("follows a scan that is already running instead of failing", async () => {
    respond(409, { errors: [{ code: "job_already_running", message: "Already running", job_id: "j0" }] });

    const result = await settledMutation(useRescanFacesMutation);

    expect(result.isSuccess).toBe(true);
    expect(toasts.jobAlreadyRunning).toHaveBeenCalledTimes(1);
    expect(toasts.rescanFaces).not.toHaveBeenCalled();
  });

  it("reports a refused scan", async () => {
    respond(403, { errors: [{ field: "detail", message: "Face detection is disabled" }] });

    const result = await settledMutation(useRescanFacesMutation);

    expect(result.isError).toBe(true);
    expect(toasts.rescanFacesFailed).toHaveBeenCalledTimes(1);
  });
});
