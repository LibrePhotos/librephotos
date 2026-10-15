/**
 * #2302: switching the Map Provider renames nothing already named. Admins look the place names
 * of every photo up again from Admin Tools, after a confirmation that says what it changes.
 */
import type { JobDetail, WorkerAvailabilityResponse } from "@librephotos/api-client";
import React from "react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { jobFixture } from "../job/jobFixture.test-utils";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { LookUpPlacesTool } from "./LookUpPlacesTool";

const stubs = vi.hoisted(() => ({
  start: vi.fn<(variables: undefined, options: { onSettled: () => void }) => void>(),
  worker: { data: undefined as WorkerAvailabilityResponse | undefined },
}));

vi.mock("../../api_client/jobs/hooks", () => ({
  useLookUpPlacesMutation: () => ({ mutate: stubs.start, isPending: false }),
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
  const { container } = await renderInMantine(<LookUpPlacesTool buttonWidth={120} />);
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

describe("LookUpPlacesTool", () => {
  it("asks first, saying what changes, and starts the job on confirm", async () => {
    const { container, button } = await renderTool();

    expect(container.textContent).toContain("Look up place names again");
    expect(button.textContent).toBe("Start");

    await click(button);

    expect(stubs.start).not.toHaveBeenCalled();
    const dialog = defined(openDialog());
    expect(dialog.textContent).toContain("Places albums under the old names end up empty");
    expect(dialog.textContent).toContain("hours for a large library");

    await click(dialogButton("Look up"));

    expect(stubs.start).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the admin cancels", async () => {
    const { button } = await renderTool();

    await click(button);
    await click(dialogButton("Cancel"));

    expect(stubs.start).not.toHaveBeenCalled();
    expect(openDialog()).toBeNull();
  });

  it("shows how far a running lookup got and links to it", async () => {
    const job: JobDetail = { ...jobFixture(), id: 7, job_type: 29, progress_current: 1, progress_target: 4 };
    stubs.worker.data = { status: true, queue_can_accept_job: false, job_detail: job };

    const { container, button } = await renderTool();

    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain("25 %");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/admin/job/7");
  });
});
