/**
 * #2223: Remove in the job list looked like deleting a log line, but a finished job is the
 * baseline of the next incremental run (#1104): removing the newest scan made the next one
 * reread far more than the user expected.
 */
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { DeleteJobButton, removeJobMessage } from "./DeleteJobButton";
import { jobFixture } from "./jobFixture.test-utils";

const stubs = vi.hoisted(() => ({
  deleteJob: vi.fn<(id: number, options?: { onSuccess?: () => void }) => void>(),
}));

vi.mock("../../api_client/jobs/hooks", () => ({
  useDeleteJobMutation: () => ({ mutate: stubs.deleteJob, isPending: false }),
}));

const finishedScan = jobFixture({
  finished: true,
  finished_at: "2026-10-10T11:00:00Z",
  progress_current: 200,
  result: { status: "completed", library_scan: true },
});

async function clickRemove(job = finishedScan) {
  const { container } = await renderInMantine(<DeleteJobButton job={job} />);
  await click(defined(container.querySelector("button")));
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.deleteJob.mockReset();
});

describe("DeleteJobButton", () => {
  it("asks first and removes nothing yet", async () => {
    await clickRemove();

    expect(openDialog()?.textContent).toContain("Remove this job?");
    expect(stubs.deleteJob).not.toHaveBeenCalled();
  });

  it("keeps the job on Cancel", async () => {
    await clickRemove();

    await click(dialogButton("Cancel"));

    expect(stubs.deleteJob).not.toHaveBeenCalled();
  });

  it("removes the job once confirmed and closes when the server has", async () => {
    await clickRemove();

    await click(dialogButton("Remove job"));
    expect(stubs.deleteJob).toHaveBeenCalledWith(7, expect.anything());

    const onSuccess = defined(defined(stubs.deleteJob.mock.calls[0])[1]?.onSuccess);
    await act(async () => onSuccess());
    expect(openDialog()).toBeNull();
  });
});

describe("removeJobMessage", () => {
  const t = i18n.t.bind(i18n);

  it("warns that the next scan rereads more when a library scan goes", () => {
    expect(removeJobMessage(finishedScan, t)).toContain("the next one rereads every file changed since");
  });

  it("warns that the next run redoes photos when a face or place run goes", () => {
    const message = removeJobMessage(jobFixture({ finished: true, job_type: 7, job_type_str: "Scan Faces" }), t);

    expect(message).toContain("Scan Faces only covers photos added since its newest successful run");
  });

  // The runs the backend never starts a later one from (LongRunningJob.baselines).
  it.each([
    ["a scan of selected files", { result: { status: "completed" } }],
    ["a cancelled scan", { cancelled: true }],
    ["a scan that failed halfway", { failed: true, progress_current: 80 }],
  ])("says nothing changes for %s", (_name, overrides) => {
    expect(removeJobMessage({ ...finishedScan, ...overrides }, t)).toContain("Nothing in your library changes");
  });

  it("still warns for a scan that failed only for item errors after reading every file", () => {
    expect(removeJobMessage({ ...finishedScan, failed: true }, t)).toContain("the next one rereads");
  });

  it("says removing a running job does not stop it", () => {
    expect(removeJobMessage(jobFixture(), t)).toContain("does not stop the job");
  });

  it("says nothing changes for a job that is no baseline", () => {
    expect(removeJobMessage(jobFixture({ finished: true, job_type: 15 }), t)).toContain(
      "Nothing in your library changes"
    );
    // Cancelled while queued: it never ran, so no later run starts from it.
    expect(removeJobMessage(jobFixture({ finished: true, started_at: null }), t)).toContain(
      "Nothing in your library changes"
    );
  });
});
