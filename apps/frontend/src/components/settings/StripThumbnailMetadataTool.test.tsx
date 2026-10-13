/**
 * #2321: removing photo details from thumbnails written by 1.2.1 or older took a terminal
 * command (`manage.py strip_thumbnail_metadata`). Admins now start it from Admin Tools.
 */
import type { JobDetail, WorkerAvailabilityResponse } from "@librephotos/api-client";
import React from "react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { jobFixture } from "../job/jobFixture.test-utils";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { StripThumbnailMetadataTool } from "./StripThumbnailMetadataTool";

const stubs = vi.hoisted(() => ({
  start: vi.fn<() => void>(),
  worker: { data: undefined as WorkerAvailabilityResponse | undefined },
}));

vi.mock("../../api_client/jobs/hooks", () => ({
  useStripThumbnailMetadataMutation: () => ({ mutate: stubs.start, isPending: false }),
  useWorkerQuery: () => stubs.worker,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, params, children, ...rest }: { to: string; params: { id: string }; children?: ReactNode }) => (
    <a href={to.replace("$id", params.id)} {...rest}>
      {children}
    </a>
  ),
}));

function busyWith(overrides: Partial<JobDetail>) {
  const job = { ...jobFixture(), progress_current: 50, progress_target: 200, ...overrides };
  stubs.worker.data = { status: true, queue_can_accept_job: false, job_detail: job };
}

async function renderTool() {
  const { container } = await renderInMantine(<StripThumbnailMetadataTool buttonWidth={120} />);
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

describe("StripThumbnailMetadataTool", () => {
  it("explains what it does and starts the job", async () => {
    const { container, button } = await renderTool();

    expect(container.textContent).toContain("Remove photo details from old thumbnails");
    expect(container.textContent).toContain("Your photos are not changed.");
    expect(button.textContent).toBe("Start");

    await click(button);

    expect(stubs.start).toHaveBeenCalledTimes(1);
  });

  it("shows how far a running cleanup got and links to it", async () => {
    busyWith({ id: 42, job_type: 23, job_type_str: "Remove Photo Details from Thumbnails" });

    const { container, button } = await renderTool();

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Running");
    expect(container.textContent).toContain("Running25 %");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/admin/job/42");
  });

  it("says the cleanup is queued, at 0 %, until the worker takes it", async () => {
    busyWith({ job_type: 23, started_at: null, progress_current: 0, progress_target: 0 });

    const { container, button } = await renderTool();

    expect(container.textContent).toContain("Queued");
    expect(container.textContent).toContain("0 %");
    expect(button.disabled).toBe(true);
  });

  it("stays available while the worker runs another job", async () => {
    busyWith({ job_type: 1 });

    const { container, button } = await renderTool();

    expect(button.disabled).toBe(false);
    expect(container.querySelector("a")).toBeNull();
  });
});
