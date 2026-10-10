import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobDetail } from "../../api_client/jobs/types";
import i18n from "../../i18n";
import { ProfileButton } from "./ProfileButton";
import { jobPercent } from "./WorkerJobMenuSection";

type Worker = { queue_can_accept_job: boolean; job_detail: JobDetail | null } | undefined;

const stubs = vi.hoisted(() => ({
  worker: undefined as Worker,
  cancelJob: vi.fn<(id: number) => void>(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn<(options: { to: string }) => void>() }));
vi.mock("../../api_client/auth", () => ({ useLogoutMutation: () => ({ mutate: vi.fn<() => void>() }) }));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { username: "admin", is_superuser: false } }),
}));
vi.mock("../../api_client/jobs/hooks", () => ({
  useCancelJobMutation: () => ({ mutate: stubs.cancelJob, isPending: false }),
}));
vi.mock("../../hooks/useWorkerStatus", () => ({
  useWorkerStatus: () => ({ currentData: stubs.worker, workerRunningJob: stubs.worker?.job_detail ?? null }),
}));

const job = (overrides: Partial<JobDetail> = {}): JobDetail => ({
  id: 7,
  job_id: "abc",
  queued_at: "2026-10-10T10:00:00Z",
  finished: false,
  finished_at: null,
  started_at: "2026-10-10T10:00:01Z",
  failed: false,
  cancelled: false,
  job_type_str: "Scan Photos",
  job_type: 1,
  started_by: { id: 1, username: "admin", first_name: "", last_name: "" },
  progress_target: 200,
  progress_current: 50,
  ...overrides,
});

let root: Root;
let container: HTMLDivElement;

const render = async (worker: Worker) => {
  stubs.worker = worker;
  await act(async () => {
    root.render(
      // env="test" renders the menu inline and without transitions.
      <MantineProvider env="test">
        <ProfileButton />
      </MantineProvider>
    );
  });
};

const avatarButton = () => {
  const found = container.querySelector<HTMLButtonElement>("button[aria-label]");
  if (!found) {
    throw new Error("no account button");
  }
  return found;
};
const ring = () => container.querySelector('[data-testid="worker-progress-ring"]');
const arcOffset = () => ring()?.querySelectorAll("circle")[1].getAttribute("stroke-dashoffset");
const openMenu = async () => act(async () => avatarButton().click());
const jobSection = () => container.querySelector('[data-testid="worker-job-section"]');

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.cancelJob.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ProfileButton worker status", () => {
  it("adds nothing while the worker is idle", async () => {
    await render({ queue_can_accept_job: true, job_detail: null });

    expect(ring()).toBeNull();
    expect(avatarButton().getAttribute("aria-label")).toBe(i18n.t("topmenu.accountmenu"));
    await openMenu();
    expect(container.textContent).toContain(i18n.t("topmenu.jobs"));
    expect(jobSection()).toBeNull();
  });

  it("adds nothing before the first worker poll has answered", async () => {
    await render(undefined);

    expect(ring()).toBeNull();
    await openMenu();
    expect(jobSection()).toBeNull();
  });

  it("rings the avatar with the job's progress and details the job in the menu", async () => {
    await render({ queue_can_accept_job: false, job_detail: job() });

    expect(arcOffset()).toBe("75");
    expect(avatarButton().getAttribute("aria-label")).toContain(i18n.t("topmenu.workerstatusbusy"));
    await openMenu();
    expect(jobSection()?.textContent).toContain("Scan Photos");
    expect(jobSection()?.textContent).toContain("50 / 200");

    const cancel = [...container.querySelectorAll("button")].find(b => b.textContent === i18n.t("joblist.cancel"));
    await act(async () => cancel?.click());
    expect(stubs.cancelJob).toHaveBeenCalledWith(7);
  });

  it("spins an open ring when the busy worker's job is not visible to this user", async () => {
    await render({ queue_can_accept_job: false, job_detail: null });

    expect(ring()?.getAttribute("class")).toContain("indeterminate");
    await openMenu();
    expect(jobSection()?.textContent).toBe(i18n.t("topmenu.busy"));
  });
});

describe("jobPercent", () => {
  it("is null without a job or a target", () => {
    expect(jobPercent(null)).toBeNull();
    expect(jobPercent(job({ progress_target: 0, progress_current: 0 }))).toBeNull();
  });

  it("clamps to 0-100", () => {
    expect(jobPercent(job({ progress_target: 10, progress_current: 15 }))).toBe(100);
    expect(jobPercent(job({ progress_target: 10, progress_current: 5 }))).toBe(50);
  });
});
