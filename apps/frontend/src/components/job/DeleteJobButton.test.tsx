/**
 * #2223: Remove in the job list looked like deleting a log line, but a finished job is the
 * baseline of the next incremental run (#1104): removing the newest scan made the next one
 * reread far more than the user expected. The server now keeps that scan (is_scan_baseline).
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

describe("DeleteJobButton on the scan baseline", () => {
  const baseline = { ...finishedScan, is_scan_baseline: true };

  it("is disabled and says why, and a click asks nothing", async () => {
    const { container } = await renderInMantine(<DeleteJobButton job={baseline} />);
    const button = defined(container.querySelector("button"));

    expect(button.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(defined(button.getAttribute("aria-describedby")));
    expect(reason?.textContent).toContain("This scan is the reference for the next incremental scan");

    await click(button);
    expect(openDialog()).toBeNull();
    expect(stubs.deleteJob).not.toHaveBeenCalled();
  });

  it("stays enabled on any other scan", async () => {
    const { container } = await renderInMantine(<DeleteJobButton job={{ ...finishedScan, is_scan_baseline: false }} />);

    expect(defined(container.querySelector("button")).getAttribute("aria-disabled")).toBeNull();
  });
});

describe("removeJobMessage", () => {
  const t = i18n.t.bind(i18n);

  // The baseline itself never gets here: its Remove is disabled and the server refuses it.
  it.each([
    ["an older library scan", {}],
    ["a scan of selected files", { result: { status: "completed" } }],
    ["a cancelled scan", { cancelled: true }],
  ])("says nothing changes for %s", (_name, overrides) => {
    const message = removeJobMessage({ ...finishedScan, ...overrides }, t);

    expect(message).toBe("The job's record and result are deleted. Nothing in your library changes.");
  });

  it("warns that the next run redoes photos when an Add Geolocation run goes", () => {
    const geolocation = jobFixture({ finished: true, job_type: 11, job_type_str: "Add Geolocation" });

    expect(removeJobMessage(geolocation, t)).toContain("only covers photos added since its newest successful run");
  });

  it("says nothing changes for an Add Geolocation run that was cut short", () => {
    const geolocation = jobFixture({ finished: true, job_type: 11, cancelled: true });

    expect(removeJobMessage(geolocation, t)).toContain("Nothing in your library changes");
  });

  it("says removing a running job does not stop it", () => {
    expect(removeJobMessage(jobFixture(), t)).toContain("does not stop the job");
  });

  // Scan Faces picks the photos it has not scanned yet, whatever ran before (faces_scanned_at).
  it.each([7, 15])("says nothing changes for a finished job of type %i", jobType => {
    expect(removeJobMessage(jobFixture({ finished: true, job_type: jobType }), t)).toContain(
      "Nothing in your library changes"
    );
  });
});
