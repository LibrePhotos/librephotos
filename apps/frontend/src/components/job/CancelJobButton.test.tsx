/**
 * #2223: Cancel in the job list stopped a job on one click, so a misclick could end a
 * scan that had been running for hours.
 */
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { CancelJobButton } from "./CancelJobButton";
import { jobFixture } from "./jobFixture.test-utils";

const stubs = vi.hoisted(() => ({
  cancelJob: vi.fn<(id: number, options?: { onSuccess?: () => void }) => void>(),
}));

vi.mock("../../api_client/jobs/hooks", () => ({
  useCancelJobMutation: () => ({ mutate: stubs.cancelJob, isPending: false }),
}));

async function clickCancel(job = jobFixture()) {
  const { container } = await renderInMantine(<CancelJobButton job={job} />);
  await click(defined(container.querySelector("button")));
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.cancelJob.mockReset();
});

describe("CancelJobButton", () => {
  it("asks first, naming the job and how long it has run", async () => {
    await clickCancel();

    expect(openDialog()?.textContent).toContain("Scan Photos has been running for");
    expect(stubs.cancelJob).not.toHaveBeenCalled();
  });

  it("keeps the job running when the user says so", async () => {
    await clickCancel();

    await click(dialogButton("Keep running"));

    expect(stubs.cancelJob).not.toHaveBeenCalled();
    expect(openDialog()).toBeNull();
  });

  it("cancels once confirmed and closes when the server has", async () => {
    await clickCancel();

    await click(dialogButton("Cancel job"));
    expect(stubs.cancelJob).toHaveBeenCalledWith(7, expect.anything());
    expect(openDialog()).not.toBeNull();

    const onSuccess = defined(defined(stubs.cancelJob.mock.calls[0])[1]?.onSuccess);
    await act(async () => onSuccess());
    expect(openDialog()).toBeNull();
  });

  it("says a queued job only leaves the queue", async () => {
    await clickCancel(jobFixture({ started_at: null }));

    expect(openDialog()?.textContent).toContain("Scan Photos has not started yet.");
    expect(dialogButton("Keep in queue")).toBeTruthy();
  });

  it("is not offered for a finished job", async () => {
    const { container } = await renderInMantine(<CancelJobButton job={jobFixture({ finished: true })} />);

    expect(container.querySelector("button")).toBeNull();
  });
});
