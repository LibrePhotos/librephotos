/**
 * "Remove finished jobs" on My Jobs (#2908): one confirm for the records of every finished job the
 * server lets go, and a disabled button that says why when there is none.
 */
import type { Job } from "@librephotos/api-client";
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { jobFixture } from "./jobFixture.test-utils";
import { RemoveFinishedJobsButton } from "./RemoveFinishedJobsButton";

type RemoveOptions = { onSuccess?: (removed: number) => void };

const stubs = vi.hoisted(() => ({
  jobs: undefined as Job[] | undefined,
  fetching: false,
  removeJobs: vi.fn<(ids: readonly number[], options?: RemoveOptions) => void>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("../../api_client/jobs/hooks", () => ({
  useAllJobsQuery: () => ({ data: stubs.jobs, isFetching: stubs.fetching }),
  useRemoveJobsMutation: () => ({ mutate: stubs.removeJobs, isPending: false }),
}));
vi.mock("../../service/notifications", () => ({ notification: { success: stubs.success } }));

const done = { finished: true, finished_at: "2026-10-10T11:00:00Z", progress_current: 200 };

async function renderButton() {
  const { container } = await renderInMantine(<RemoveFinishedJobsButton />);
  return defined(container.querySelector("button"));
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.removeJobs.mockReset();
  stubs.success.mockReset();
  stubs.fetching = false;
  stubs.jobs = [
    jobFixture({ id: 1, ...done }),
    jobFixture({ id: 2, ...done, failed: true }),
    jobFixture({ id: 3 }),
    jobFixture({ id: 4, ...done, is_scan_baseline: true }),
  ];
});

describe("RemoveFinishedJobsButton", () => {
  it("asks first, naming how many jobs go, and removes nothing yet", async () => {
    await click(await renderButton());

    expect(openDialog()?.textContent).toContain("Remove finished jobs?");
    expect(openDialog()?.textContent).toContain("The records of 2 finished jobs are deleted.");
    expect(stubs.removeJobs).not.toHaveBeenCalled();
  });

  it("says job, not jobs, for one", async () => {
    stubs.jobs = [jobFixture({ id: 1, ...done })];
    await click(await renderButton());

    expect(openDialog()?.textContent).toContain("The record of 1 finished job is deleted.");
  });

  it("keeps everything on Cancel", async () => {
    await click(await renderButton());
    await click(dialogButton("Cancel"));

    expect(stubs.removeJobs).not.toHaveBeenCalled();
  });

  it("removes only the finished jobs the server lets go, then closes and says how many went", async () => {
    await click(await renderButton());
    await click(dialogButton("Remove jobs"));

    expect(stubs.removeJobs).toHaveBeenCalledWith([1, 2], expect.anything());
    const onSuccess = defined(defined(stubs.removeJobs.mock.calls[0])[1]?.onSuccess);
    await act(async () => onSuccess(2));
    expect(openDialog()).toBeNull();
    expect(stubs.success).toHaveBeenCalledWith("Removed 2 jobs");
  });

  it("is disabled, says why and asks nothing when no job can go", async () => {
    stubs.jobs = [jobFixture({ id: 3 }), jobFixture({ id: 4, ...done, is_scan_baseline: true })];
    const button = await renderButton();

    expect(button.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(defined(button.getAttribute("aria-describedby")));
    expect(reason?.textContent).toContain("There are no finished jobs to remove.");
    await click(button);
    expect(openDialog()).toBeNull();
  });

  it("is not disabled while the jobs are still loading", async () => {
    stubs.jobs = undefined;
    stubs.fetching = true;

    expect((await renderButton()).getAttribute("aria-disabled")).toBeNull();
  });
});
