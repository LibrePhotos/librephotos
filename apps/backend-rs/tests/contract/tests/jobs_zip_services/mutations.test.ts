// Successful job cancel and delete (JobList buttons), sent once to each
// server. Only with LP_MUTATION=1 on two fresh clones with their own media
// copies (run_suite.sh mut:jobs), which then diffs both databases.
import { CancelJobResponse } from "@fe/jobs/types";
import { describe, expect, it } from "vitest";

import { hasBase } from "../../src/env";
import { manifest } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

const enabled = hasBase && process.env.LP_MUTATION === "1";
const jobs = () => manifest().jobs;
const DETAIL = ["id", "job_id", "finished", "failed", "cancelled", "job_type", "job_type_str", "progress_current", "progress_target"];
// finished_at is the moment each server handled the cancel.
const CANCEL = ["status", "message", "errors[].*", ...DETAIL.map(f => `job.${f}`)];

describe.skipIf(!enabled).sequential("job mutations", () => {
  it("POST /api/jobs/{id}/cancel/: the owner cancels a running job", async () => {
    const running = jobs().running;
    const { actual } = await expectTwin(
      "alice",
      { method: "POST", path: `/api/jobs/${running.id}/cancel/`, body: {} },
      { project: CANCEL, refStable: false },
    );
    expect(actual.status).toBe(200);
    expectSchema(CancelJobResponse, actual.body);
    const detail = await expectTwin("alice", { path: `/api/jobs/${running.id}/` }, { project: DETAIL });
    expect((detail.actual.body as { cancelled: boolean }).cancelled).toBe(true);
    // A second cancel finds it finished.
    await expectTwin("alice", { method: "POST", path: `/api/jobs/${running.id}/cancel/`, body: {} }, { project: CANCEL, refStable: false });
  });

  it("DELETE /api/jobs/{id}/: the owner deletes a failed job, the admin their finished one", async () => {
    for (const [role, job] of [
      ["alice", jobs().failed],
      ["admin", jobs().finished],
    ] as const) {
      const { actual } = await expectTwin(role, { method: "DELETE", path: `/api/jobs/${job.id}/` }, { project: ["*"], refStable: false });
      expect(actual.status).toBe(204);
      await expectTwin(role, { path: `/api/jobs/${job.id}/` }, { project: ["errors[].*"] });
      await expectTwin(role, { method: "DELETE", path: `/api/jobs/${job.id}/` }, { project: ["errors[].*"], refStable: false });
    }
  });
});
