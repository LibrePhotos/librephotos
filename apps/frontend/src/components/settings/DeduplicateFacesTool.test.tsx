/**
 * #2030: face deduplication was only in the Django admin. Admins start it from Admin Tools,
 * after a confirmation that says what it deletes.
 */
import type { JobDetail, WorkerAvailabilityResponse } from "@librephotos/api-client";
import React from "react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { jobFixture } from "../job/jobFixture.test-utils";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { DeduplicateFacesTool } from "./DeduplicateFacesTool";

const stubs = vi.hoisted(() => ({
  start: vi.fn<(variables: undefined, options: { onSettled: () => void }) => void>(),
  worker: { data: undefined as WorkerAvailabilityResponse | undefined },
}));

vi.mock("../../api_client/jobs/hooks", () => ({
  useDeduplicateFacesMutation: () => ({ mutate: stubs.start, isPending: false }),
  useWorkerQuery: () => stubs.worker,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, params, children, ...rest }: { to: string; params: { id: string }; children?: ReactNode }) => (
    <a href={to.replace("$id", params.id)} {...rest}>
      {children}
    </a>
  ),
}));

async function renderTool() {
  const { container } = await renderInMantine(<DeduplicateFacesTool buttonWidth={120} />);
  return { container, button: defined(container.querySelector("button")) };
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.start.mockReset();
  stubs.worker.data = { status: true, queue_can_accept_job: true, job_detail: null };
});

describe("DeduplicateFacesTool", () => {
  it("asks first, saying what changes, and starts the job on confirm", async () => {
    const { container, button } = await renderTool();

    expect(container.textContent).toContain("Remove duplicate faces");
    expect(button.textContent).toBe("Start");

    await click(button);

    expect(stubs.start).not.toHaveBeenCalled();
    const dialog = defined(openDialog());
    expect(dialog.textContent).toContain("the one without a name is deleted");
    expect(dialog.textContent).toContain("cannot be restored");

    await click(dialogButton("Remove duplicates"));

    expect(stubs.start).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the admin cancels", async () => {
    const { button } = await renderTool();

    await click(button);
    await click(dialogButton("Cancel"));

    expect(stubs.start).not.toHaveBeenCalled();
    expect(openDialog()).toBeNull();
  });

  it("shows how far a running deduplication got and links to it", async () => {
    const job: JobDetail = { ...jobFixture(), id: 7, job_type: 31, progress_current: 1, progress_target: 4 };
    stubs.worker.data = { status: true, queue_can_accept_job: false, job_detail: job };

    const { container, button } = await renderTool();

    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain("25 %");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/admin/job/7");
  });
});
