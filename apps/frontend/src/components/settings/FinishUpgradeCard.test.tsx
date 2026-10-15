/**
 * #2322: after an update, the follow-up work was only in the release notes, and on Windows it
 * needed a terminal. The Admin page now heads with a card listing what is left, one row per task.
 */
import type { UpgradeTask } from "@librephotos/api-client";
import React from "react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { FinishUpgradeCard } from "./FinishUpgradeCard";

const stubs = vi.hoisted(() => ({
  start: vi.fn<(key: string) => void>(),
  dismiss: vi.fn<(key: string) => void>(),
  busy: false,
}));

vi.mock("../../api_client/jobs/hooks/useUpgradeTasks", () => ({
  isOpenTask: (task: { status: string }) => task.status !== "done",
  useStartUpgradeTaskMutation: () => ({ mutate: stubs.start, isPending: false, variables: undefined }),
  useDismissUpgradeTaskMutation: () => ({ mutate: stubs.dismiss }),
}));
vi.mock("../../hooks/useJobQueue", () => ({ useJobQueue: () => ({ busy: stubs.busy, job: null }) }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, params, children, ...rest }: { to: string; params: { id: string }; children?: ReactNode }) => (
    <a href={to.replace("$id", params.id)} {...rest}>
      {children}
    </a>
  ),
}));

function task(overrides: Partial<UpgradeTask> = {}): UpgradeTask {
  return {
    key: "strip_thumbnail_metadata",
    kind: "automatic",
    optional: false,
    status: "pending",
    count: null,
    progress_current: null,
    progress_target: null,
    latest_job_id: null,
    error: null,
    completed_at: null,
    ...overrides,
  };
}

const SEARCH = task({
  key: "semantic_search_conversion",
  status: "running",
  progress_current: 12400,
  progress_target: 30000,
  latest_job_id: 42,
});
const FAILED = task({ status: "failed", error: "the disk is full", latest_job_id: 43 });
const PROBE = task({ key: "probe_videos", kind: "action", optional: true, count: 120 });

async function renderCard(tasks: UpgradeTask[]) {
  const { container } = await renderInMantine(<FinishUpgradeCard tasks={tasks} />);
  return container;
}

function rows(container: HTMLElement): HTMLLIElement[] {
  return [...container.querySelectorAll("li")];
}

function button(row: HTMLElement, label: string): HTMLButtonElement {
  return defined(
    [...row.querySelectorAll("button")].find(candidate => candidate.textContent === label),
    `the ${label} button`
  );
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.start.mockReset();
  stubs.dismiss.mockReset();
  stubs.busy = false;
});

describe("FinishUpgradeCard", () => {
  it("counts the tasks left and explains each one", async () => {
    const container = await renderCard([SEARCH, FAILED, PROBE]);

    expect(container.querySelector("h4")?.textContent).toBe("Finish the upgrade");
    expect(container.textContent).toContain("3 left");
    const [search, strip, probe] = rows(container).map(row => row.textContent ?? "");
    expect(search).toContain("Update search for the new search model");
    expect(search).toContain("Automatic");
    expect(strip).toContain("Your photos are not changed.");
    expect(probe).toContain("Read colour information of 120 older videos");
    expect(probe).toContain("Optional");
  });

  it("shows a running task's progress with a link to its job, and no button", async () => {
    const container = await renderCard([SEARCH]);
    const [row] = rows(container);

    expect(defined(row).textContent).toContain("12,400 of 30,000 · 41%");
    expect(defined(row).querySelector("a")?.getAttribute("href")).toBe("/admin/job/42");
    expect(defined(row).querySelector("button")).toBeNull();
    expect(defined(row).textContent).toContain("Running");
  });

  it("offers Retry with the reason after a failed run, and no Not now for a required task", async () => {
    const container = await renderCard([FAILED]);
    const row = defined(rows(container)[0]);

    expect(row.textContent).toContain("Stopped: the disk is full");
    await click(button(row, "Retry"));
    expect(stubs.start).toHaveBeenCalledWith("strip_thumbnail_metadata");
    expect([...row.querySelectorAll("button")].map(b => b.textContent)).toEqual(["Retry"]);
  });

  it("starts an optional task, or hides it with Not now", async () => {
    const container = await renderCard([PROBE]);
    const row = defined(rows(container)[0]);

    await click(button(row, "Start"));
    expect(stubs.start).toHaveBeenCalledWith("probe_videos");
    await click(button(row, "Not now"));
    expect(stubs.dismiss).toHaveBeenCalledWith("probe_videos");
  });

  it("says why Start waits while another job runs", async () => {
    stubs.busy = true;
    const container = await renderCard([PROBE]);
    const row = defined(rows(container)[0]);
    const start = button(row, "Start");

    expectDisabledWithReason(start, "A job is running. Start this one when it has finished.");
    expect(row.textContent).toContain("A job is running.");
    await click(start);
    expect(stubs.start).not.toHaveBeenCalled();
  });

  it("says the upgrade is finished when every task is done", async () => {
    const container = await renderCard([task({ status: "done", completed_at: new Date().toISOString() })]);

    expect(container.querySelector("h4")?.textContent).toBe("The upgrade is finished");
    expect(container.textContent).not.toContain("1 left");
    expect(container.textContent).toContain("Done");
    expect(container.querySelector("button")).toBeNull();
  });

  it("still names a task this app does not know", async () => {
    const container = await renderCard([task({ key: "from_a_newer_server" })]);
    expect(container.textContent).toContain("Another task from the update (from_a_newer_server)");
  });
});
