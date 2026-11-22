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
    web_mb: 300,
    sidecars_mb: 1120,
    face_replicas: 2,
    face_replica_mb: 256,
    face_vram_mb: 0,
    face_device: "cpu",
    face_limited_by: "lanes",
    vram_budget_mb: null,
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
    face_override: null,
    face_services: { running: 0, live: 0, device: null, rss_mb: [], gpu_total_mb: null, gpu_free_mb: null },
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

  it("shows the face services the choice gives and what they use", async () => {
    stubs.status = status({
      face_services: { running: 2, live: 2, device: "cpu", rss_mb: [200, 312], gpu_total_mb: null, gpu_free_mb: null },
    });
    const container = await render();
    const text = container.textContent ?? "";
    expect(text).toContain("Face recognition: 2 face services side by side, about 0.3 GB each.");
    expect(text).toContain("Face services running now: 2, using 0.5 GB.");
  });

  it("says why there are fewer face services than heavy workers", async () => {
    stubs.status = status({
      face_override: 6,
      plans: [
        plan("gentle"),
        plan("balanced", {
          heavy_workers: 4,
          face_replicas: 1,
          face_limited_by: "gpu",
          face_device: "unknown",
          face_replica_mb: 1126,
          face_vram_mb: 563,
        }),
        plan("fast"),
      ],
    });
    const container = await render();
    const text = container.textContent ?? "";
    expect(text).toContain("1 face service on the GPU, about 1.1 GB of memory and 0.5 GB of GPU memory.");
    expect(text).toContain("cannot tell how much GPU memory there is");
    expect(text).toContain("FACE_SIDECAR_REPLICAS asks for 6 face services; 1 fit, so 1 run.");
  });

  it("names memory as the limit of the face services", async () => {
    stubs.status = status({
      plans: [
        plan("gentle"),
        plan("balanced", { heavy_workers: 3, face_replicas: 2, face_limited_by: "memory" }),
        plan("fast"),
      ],
    });
    const container = await render();
    expect(container.textContent ?? "").toContain(
      "Fewer face services than heavy workers (3): more do not fit in memory."
    );
  });
});
