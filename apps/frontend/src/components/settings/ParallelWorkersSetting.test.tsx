import type { ParallelWorkers, WorkerIntention, WorkerPlan } from "@librephotos/api-client";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { ParallelWorkersSetting } from "./ParallelWorkersSetting";

const stubs = vi.hoisted(() => ({
  status: undefined as ParallelWorkers | undefined,
  choose: vi.fn<(intention: WorkerIntention) => void>(),
}));

vi.mock("../../api_client/server", () => ({
  useParallelWorkersQuery: () => ({ data: stubs.status }),
  useSetWorkerIntentionMutation: () => ({ mutate: stubs.choose, isPending: false }),
}));

function plan(intention: string, overrides: Partial<WorkerPlan> = {}): WorkerPlan {
  return {
    intention,
    workers: 2,
    heavy_workers: 2,
    budget_mb: 4096,
    needed_mb: 2700,
    limited_by: "intention",
    fits: true,
    ...overrides,
  };
}

function status(overrides: Partial<ParallelWorkers> = {}): ParallelWorkers {
  return {
    capacity: {
      cores: 4,
      cpu_source: "cgroup v2",
      ram_total_mb: 8192,
      ram_available_mb: 6144,
      ram_source: "cgroup v2",
    },
    intention: "balanced",
    override: null,
    plans: [plan("gentle", { workers: 1 }), plan("balanced"), plan("fast", { workers: 3 })],
    workers: [
      {
        name: "box:0",
        slot: 0,
        active: true,
        rss_mb: 210,
        heartbeat_at: "2026-11-21T10:00:00Z",
        memory_recycles: 1,
        last_recycle: "over its memory limit",
      },
      {
        name: "box:1",
        slot: 1,
        active: false,
        rss_mb: 120,
        heartbeat_at: "2026-11-21T10:00:00Z",
        memory_recycles: 0,
        last_recycle: "",
      },
    ],
    ...overrides,
  };
}

async function render() {
  const { container } = await renderInMantine(<ParallelWorkersSetting />);
  return container;
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  stubs.status = status();
});

describe("ParallelWorkersSetting", () => {
  it("says what was detected and what the choice gives", async () => {
    const container = await render();
    const text = container.textContent ?? "";
    expect(text).toContain("This machine: 4 cores, 8.0 GB of memory (container limit), 6.0 GB free.");
    expect(text).toContain("2 workers, using about 2.6 GB of a 4.0 GB budget.");
    expect(text).toContain("Running now: 1 of 2 workers active, 1 restarted for memory.");
  });

  it("saves the intention picked", async () => {
    const container = await render();
    const fast = defined(
      Array.from(container.querySelectorAll("label")).find(label => label.textContent === "Fast first import"),
      "the Fast first import option"
    );
    await click(fast);
    expect(stubs.choose).toHaveBeenCalledWith("fast");
  });

  it("warns when even one worker does not fit and names the override", async () => {
    stubs.status = status({
      override: 3,
      plans: [
        plan("gentle"),
        plan("balanced", { workers: 1, fits: false, limited_by: "memory", budget_mb: 1200, needed_mb: 2100 }),
        plan("fast"),
      ],
    });
    const container = await render();
    const text = container.textContent ?? "";
    expect(text).toContain("Even one worker needs about 2.1 GB, and 1.2 GB are free for LibrePhotos.");
    expect(text).toContain("WORKER_CONCURRENCY sets 3 workers");
  });
});
