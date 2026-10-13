/**
 * #2213: the job detail page showed a running job's progress but no way to stop it, nor to
 * remove a finished one; both meant going back to the list and finding the row.
 */
import type { JobDetail } from "@librephotos/api-client";
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, dialogButton, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { JobDetailView } from "./JobDetailView";
import { jobFixture } from "./jobFixture.test-utils";

type MutateOptions = { onSuccess?: () => void };

const stubs = vi.hoisted(() => ({
  job: undefined as JobDetail | undefined,
  cancelJob: vi.fn<(id: number, options?: MutateOptions) => void>(),
  deleteJob: vi.fn<(id: number, options?: MutateOptions) => void>(),
  navigate: vi.fn<(options: { to: string }) => void>(),
}));

vi.mock("../../api_client/jobs/hooks", () => ({
  useJobQuery: () => ({ data: stubs.job, isLoading: false, isError: false }),
  useCancelJobMutation: () => ({ mutate: stubs.cancelJob, isPending: false }),
  useDeleteJobMutation: () => ({ mutate: stubs.deleteJob, isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));

function detail(overrides: Partial<JobDetail> = {}): JobDetail {
  return { ...jobFixture(), progress_current: 50, progress_target: 200, ...overrides };
}

async function renderPage(job: JobDetail) {
  stubs.job = job;
  const { container } = await renderInMantine(<JobDetailView jobId={job.id} backTo="/admin" />);
  return container;
}

/** The header's buttons, by label. */
function headerButtons(container: HTMLElement): string[] {
  const header = defined(container.querySelector("h1")?.closest(".mantine-Group-root")?.parentElement);
  return [...header.querySelectorAll("button")].map(button => button.textContent?.trim() ?? "");
}

function headerButton(container: HTMLElement, label: string): HTMLButtonElement {
  return defined([...container.querySelectorAll("button")].find(button => button.textContent?.trim() === label));
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.cancelJob.mockReset();
  stubs.deleteJob.mockReset();
  stubs.navigate.mockReset();
});

describe("JobDetailView header", () => {
  it("offers Cancel and Remove while the job runs, and cancels it once confirmed", async () => {
    const container = await renderPage(detail());

    expect(headerButtons(container)).toEqual(["Cancel", "Remove"]);

    await click(headerButton(container, "Cancel"));
    await click(dialogButton("Cancel job"));

    expect(stubs.cancelJob).toHaveBeenCalledWith(7, expect.anything());
  });

  it("offers only Remove once the job has finished", async () => {
    const container = await renderPage(detail({ finished: true, finished_at: "2026-10-10T11:00:00Z" }));

    expect(headerButtons(container)).toEqual(["Remove"]);
  });

  it("goes back to the list once the job is removed", async () => {
    const container = await renderPage(detail({ finished: true, finished_at: "2026-10-10T11:00:00Z" }));

    await click(headerButton(container, "Remove"));
    await click(dialogButton("Remove job"));
    expect(stubs.deleteJob).toHaveBeenCalledWith(7, expect.anything());
    expect(stubs.navigate).not.toHaveBeenCalled();

    const onSuccess = defined(defined(stubs.deleteJob.mock.calls[0])[1]?.onSuccess);
    await act(async () => onSuccess());

    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/admin" });
  });
});
