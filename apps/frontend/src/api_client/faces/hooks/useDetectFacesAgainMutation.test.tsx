/**
 * Detect faces again in a folder or in some photos (#524): POSTs the scope to /api/scanfaces and
 * says what it looks at, or why it did not start.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { settledMutationWith } from "../../../util/hookHarness.test-utils";
import { useDetectFacesAgainMutation } from "./useDetectFacesAgainMutation";

const toasts = vi.hoisted(() => ({
  detectFacesAgain: vi.fn<(count: number | null) => void>(),
  detectFacesAgainFailed: vi.fn<(message: string) => void>(),
  jobAlreadyRunning: vi.fn<() => void>(),
}));
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

const started = { status: true, job_id: "j1", job_ids: ["j1"] };

describe("useDetectFacesAgainMutation", () => {
  it("sends the photos and counts them in the toast", async () => {
    const fetchMock = respond(200, started);

    await settledMutationWith(useDetectFacesAgainMutation, { photo_ids: ["p1", "p2"] });

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ photo_ids: ["p1", "p2"] }));
    expect(toasts.detectFacesAgain).toHaveBeenCalledWith(2);
  });

  it("sends a folder", async () => {
    const fetchMock = respond(200, started);

    await settledMutationWith(useDetectFacesAgainMutation, { path: "/data/alice/2025" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/scanfaces");
    expect(toasts.detectFacesAgain).toHaveBeenCalledWith(null);
  });

  it("follows a face scan that is already running", async () => {
    respond(409, { errors: [{ code: "job_already_running", message: "Already running", job_id: "j0" }] });

    await settledMutationWith(useDetectFacesAgainMutation, { path: "/data/alice" });

    expect(toasts.jobAlreadyRunning).toHaveBeenCalledTimes(1);
    expect(toasts.detectFacesAgain).not.toHaveBeenCalled();
  });

  it("says why it did not start", async () => {
    const message = "This folder is not in your library.";
    respond(400, { errors: [{ field: "path", message, code: "path_outside_library" }] });

    const result = await settledMutationWith(useDetectFacesAgainMutation, { path: "/elsewhere" });

    expect(result.isError).toBe(true);
    expect(toasts.detectFacesAgainFailed).toHaveBeenCalledWith(message);
  });
});
