import type { ImportJob, JobDetail } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { ShortcutsOverlayContext } from "../shortcuts/shortcutsOverlay";
import type { UploadProcessing } from "../upload/useUploadProcessing";
import { WhatsNewContext } from "../whatsnew/whatsNewContext";
import { ProfileButton } from "./ProfileButton";
import { jobPercent } from "./WorkerJobMenuSection";

type Worker = { queue_can_accept_job: boolean; job_detail: JobDetail | null } | undefined;

const stubs = vi.hoisted(() => ({
  worker: undefined as Worker,
  isAdmin: false,
  upgradeTasksLeft: 0,
  cancelJob: vi.fn<(id: number, options?: { onSuccess?: () => void }) => void>(),
  openImports: [] as ImportJob[],
  openWhatsNew: vi.fn<(releases?: readonly string[]) => void>(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn<(options: { to: string }) => void>() }));
vi.mock("../../api_client/auth", () => ({ useLogoutMutation: () => ({ mutate: vi.fn<() => void>() }) }));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { username: "admin", is_superuser: stubs.isAdmin } }),
}));
vi.mock("../../api_client/jobs/hooks/useUpgradeTasks", () => ({
  useOpenUpgradeTaskCount: (isAdmin: boolean) => (isAdmin ? stubs.upgradeTasksLeft : 0),
}));
vi.mock("../../api_client/jobs/hooks", () => ({
  useCancelJobMutation: () => ({ mutate: stubs.cancelJob, isPending: false }),
}));
vi.mock("../upload/UploadContext", async importOriginal => ({
  ...(await importOriginal<typeof import("../upload/UploadContext")>()),
  useOptionalUploadProcessing: (): Pick<UploadProcessing, "openImports"> => ({ openImports: stubs.openImports }),
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
        <WhatsNewContext.Provider value={{ open: stubs.openWhatsNew }}>
          <ProfileButton />
        </WhatsNewContext.Provider>
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
const arcOffset = () => ring()?.querySelectorAll("circle")[1]?.getAttribute("stroke-dashoffset");
const openMenu = async () => act(async () => avatarButton().click());
const jobSection = () => container.querySelector('[data-testid="worker-job-section"]');
const dialog = () => document.querySelector('[role="dialog"]');
const dialogButton = (label: string) =>
  [...(dialog()?.querySelectorAll("button") ?? [])].find(b => b.textContent === label);

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
  stubs.isAdmin = false;
  stubs.upgradeTasksLeft = 0;
  stubs.openImports = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ProfileButton upload imports (#2739)", () => {
  const importJob = (overrides: Partial<ImportJob> = {}): ImportJob => ({
    ...job({ job_type: 20, job_type_str: "Import Uploads", progress_current: 12, progress_target: 40 }),
    result: { stages: {} },
    ...overrides,
  });
  const importSection = () => container.querySelector('[data-testid="import-job-section"]');

  it("rings the avatar with the import's progress and adds its own section, without Cancel", async () => {
    stubs.openImports = [importJob()];
    await render({ queue_can_accept_job: true, job_detail: null });

    expect(arcOffset()).toBe("70");
    expect(avatarButton().getAttribute("aria-label")).toContain(i18n.t("topmenu.workerstatusimporting"));
    await openMenu();
    expect(importSection()?.textContent).toContain("Importing your uploads");
    expect(importSection()?.textContent).toContain("12 / 40 ready");
    expect(importSection()?.querySelector("button")).toBeNull();
    expect(jobSection()).toBeNull();
  });

  it("keeps the running job's ring and section beside the import", async () => {
    stubs.openImports = [importJob()];
    await render({ queue_can_accept_job: false, job_detail: job() });

    expect(arcOffset()).toBe("75");
    await openMenu();
    expect(jobSection()).not.toBeNull();
    expect(importSection()).not.toBeNull();
  });
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
  });

  it("asks before cancelling the running job, in a dialog that outlives the menu", async () => {
    await render({ queue_can_accept_job: false, job_detail: job() });
    await openMenu();

    const cancel = [...container.querySelectorAll("button")].find(b => b.textContent === i18n.t("joblist.cancel"));
    await act(async () => cancel?.click());

    // The menu closed, the question stays, and nothing is cancelled yet.
    expect(jobSection()).toBeNull();
    expect(dialog()?.textContent).toContain("Scan Photos has been running for");
    expect(stubs.cancelJob).not.toHaveBeenCalled();

    await act(async () => dialogButton("Keep running")?.click());
    expect(stubs.cancelJob).not.toHaveBeenCalled();
  });

  it("cancels the job the dialog was opened for once confirmed", async () => {
    await render({ queue_can_accept_job: false, job_detail: job() });
    await openMenu();
    const cancel = [...container.querySelectorAll("button")].find(b => b.textContent === i18n.t("joblist.cancel"));
    await act(async () => cancel?.click());

    // Another job took over while the dialog was open.
    await render({ queue_can_accept_job: false, job_detail: job({ id: 8, job_type: 7, job_type_str: "Scan Faces" }) });
    await act(async () => dialogButton("Cancel job")?.click());

    expect(stubs.cancelJob).toHaveBeenCalledWith(7, expect.anything());
  });

  it("spins an open ring when the busy worker's job is not visible to this user", async () => {
    await render({ queue_can_accept_job: false, job_detail: null });

    expect(ring()?.getAttribute("class")).toContain("indeterminate");
    await openMenu();
    expect(jobSection()?.textContent).toBe(i18n.t("topmenu.busy"));
  });
});

describe("ProfileButton upgrade tasks (#2322)", () => {
  const adminItem = () =>
    [...container.querySelectorAll<HTMLElement>("[role=menuitem]")].find(item =>
      item.textContent?.startsWith(i18n.t("topmenu.adminarea"))
    );
  const dot = () => container.querySelector(".mantine-Indicator-indicator");

  it("puts a dot on the avatar and the count on Admin Area while tasks are left", async () => {
    stubs.isAdmin = true;
    stubs.upgradeTasksLeft = 2;
    await render({ queue_can_accept_job: true, job_detail: null });

    expect(dot()).not.toBeNull();
    expect(avatarButton().getAttribute("aria-label")).toBe(
      `${i18n.t("topmenu.accountmenu")}, ${i18n.t("topmenu.upgradetasks", { count: 2 })}`
    );
    await openMenu();
    expect(adminItem()?.textContent).toBe(`${i18n.t("topmenu.adminarea")}22 upgrade tasks left`);
  });

  it("shows neither when nothing is left", async () => {
    stubs.isAdmin = true;
    await render({ queue_can_accept_job: true, job_detail: null });

    expect(dot()).toBeNull();
    await openMenu();
    // No count, only the g a chord hint (#2037).
    expect(adminItem()?.textContent).toBe(`${i18n.t("topmenu.adminarea")}g a`);
  });
});

describe("ProfileButton keyboard shortcuts (#2037)", () => {
  const shortcutsItem = () =>
    [...container.querySelectorAll<HTMLElement>("[role=menuitem]")].find(item =>
      item.textContent?.startsWith(i18n.t("topmenu.shortcuts"))
    );

  it("lists the chords next to the pages and opens the list of shortcuts", async () => {
    const openShortcuts = vi.fn<() => void>();
    stubs.worker = { queue_can_accept_job: true, job_detail: null };
    await act(async () => {
      root.render(
        <MantineProvider env="test">
          <ShortcutsOverlayContext value={openShortcuts}>
            <ProfileButton />
          </ShortcutsOverlayContext>
        </MantineProvider>
      );
    });
    await openMenu();

    const settings = [...container.querySelectorAll<HTMLElement>("[role=menuitem]")].find(item =>
      item.textContent?.startsWith(i18n.t("topmenu.settings"))
    );
    expect(settings?.textContent).toBe(`${i18n.t("topmenu.settings")}g s`);
    expect(shortcutsItem()?.textContent).toBe(`${i18n.t("topmenu.shortcuts")}?`);
    await act(async () => shortcutsItem()?.click());
    expect(openShortcuts).toHaveBeenCalledOnce();
  });

  it("has no shortcuts entry outside the signed-in app (public pages)", async () => {
    await render({ queue_can_accept_job: true, job_detail: null });
    await openMenu();

    expect(shortcutsItem()).toBeUndefined();
  });
});

describe("ProfileButton What's new", () => {
  it("opens the What's new dialog from the account menu (#2305)", async () => {
    await render({ queue_can_accept_job: true, job_detail: null });
    await openMenu();
    const item = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      candidate => candidate.textContent === i18n.t("whatsnew.menu")
    );
    expect(item).toBeDefined();
    await act(async () => item?.click());
    expect(stubs.openWhatsNew).toHaveBeenCalledWith();
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
