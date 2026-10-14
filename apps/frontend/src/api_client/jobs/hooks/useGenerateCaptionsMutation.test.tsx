/**
 * "Generate captions" on the Library page (#2211) starts the caption job through
 * /api/generate-captions/ and says whether it waits for the captioning model's download.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { settledMutationWith } from "../../../util/hookHarness.test-utils";
import { useGenerateCaptionsMutation } from "./useGenerateCaptionsMutation";

const toasts = vi.hoisted(() => ({
  startCaptionsJob: vi.fn<(fullScan: boolean, downloadsModel: boolean) => void>(),
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

const started = { status: true, job_id: "j1", job_ids: ["j1"] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useGenerateCaptionsMutation", () => {
  it("POSTs full_scan and says the job started", async () => {
    const fetchMock = respond(200, { ...started, downloads_model: false });

    await settledMutationWith(useGenerateCaptionsMutation, true);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/generate-captions/");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ full_scan: true }) });
    expect(toasts.startCaptionsJob).toHaveBeenCalledWith(true, false);
  });

  it("says when the captioning model is downloaded first", async () => {
    respond(200, { ...started, downloads_model: true });

    await settledMutationWith(useGenerateCaptionsMutation, false);

    expect(toasts.startCaptionsJob).toHaveBeenCalledWith(false, true);
  });

  it("says nothing more when the job is already running", async () => {
    respond(409, { errors: [{ code: "job_already_running", message: "Already running", job_id: "j0" }] });

    await settledMutationWith(useGenerateCaptionsMutation, false);

    expect(toasts.jobAlreadyRunning).toHaveBeenCalledTimes(1);
    expect(toasts.startCaptionsJob).not.toHaveBeenCalled();
  });
});
