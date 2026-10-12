/**
 * "Regenerate Event Titles" re-titles every event album through
 * /autoalbumtitlegen/ (not /autoalbumgen/, which only titles changed albums).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { settledMutation } from "../../../util/hookHarness.test-utils";
import { useRegenerateEventTitlesMutation } from "./useRegenerateEventTitlesMutation";

const toasts = vi.hoisted(() => ({
  regenerateEventAlbums: vi.fn<() => void>(),
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

describe("useRegenerateEventTitlesMutation", () => {
  it("POSTs /api/autoalbumtitlegen/ and says the job started", async () => {
    const fetchMock = respond(200, { status: true, job_id: "j1" });

    await settledMutation(useRegenerateEventTitlesMutation);

    expect(fetchMock).toHaveBeenCalledWith("/api/autoalbumtitlegen/", expect.objectContaining({ method: "POST" }));
    expect(toasts.regenerateEventAlbums).toHaveBeenCalledTimes(1);
  });

  it("says nothing more when the job is already running", async () => {
    respond(409, { errors: [{ code: "job_already_running", message: "Already running", job_id: "j0" }] });

    await settledMutation(useRegenerateEventTitlesMutation);

    expect(toasts.jobAlreadyRunning).toHaveBeenCalledTimes(1);
    expect(toasts.regenerateEventAlbums).not.toHaveBeenCalled();
  });
});
