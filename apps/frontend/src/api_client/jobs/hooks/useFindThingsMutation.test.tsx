/**
 * "Find" in the Library page's Things section (#2765) starts the Things job through
 * /api/find-things/, on the photos without things or every photo again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { settledMutationWith } from "../../../util/hookHarness.test-utils";
import { useFindThingsMutation } from "./useFindThingsMutation";

const toasts = vi.hoisted(() => ({
  startThingsJob: vi.fn<(fullScan: boolean) => void>(),
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

describe("useFindThingsMutation", () => {
  it("POSTs full_scan and says the job started", async () => {
    const fetchMock = respond(200, { status: true, job_id: "j1", job_ids: ["j1"] });

    await settledMutationWith(useFindThingsMutation, true);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/find-things/");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ full_scan: true }) });
    expect(toasts.startThingsJob).toHaveBeenCalledWith(true);
  });

  it("says nothing more when the job is already running", async () => {
    respond(409, { errors: [{ code: "job_already_running", message: "Already running", job_id: "j0" }] });

    await settledMutationWith(useFindThingsMutation, false);

    expect(toasts.jobAlreadyRunning).toHaveBeenCalledTimes(1);
    expect(toasts.startThingsJob).not.toHaveBeenCalled();
  });
});
