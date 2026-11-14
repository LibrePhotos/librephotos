// Buttons that start jobs: scan, full scan, delete missing photos, OCR.
// These enqueue work, so the contract cases run against the server under
// test only; the reference is only asked what it refuses. The Rust server
// runs its worker in-process, so the jobs may already be done when listed:
// they are started as dave, whose one photo no other case depends on.
import { JobDetail } from "@fe/jobs/types";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { expectSchema } from "../../src/schema";
import { DeleteMissingPhotosResponse, JobResponse } from "../../src/schemas/jobs_zip_services";

const ROLE = "dave";

async function jobByUuid(jobId: string) {
  const list = await call<{ results: { id: number; job_id: string }[] }>(ROLE, {
    path: "/api/jobs/",
    query: { page_size: 50, page: 1 },
  });
  const row = list.body.results.find(j => j.job_id === jobId);
  expect(row, `job ${jobId} listed`).toBeDefined();
  const res = await call(ROLE, { path: `/api/jobs/${row!.id}/` });
  return expectSchema(JobDetail, res.body);
}

describe.skipIf(!hasBase)("job-starting buttons (contract, server under test)", () => {
  it.each([
    ["/api/scanphotos/", {}, 1],
    ["/api/fullscanphotos/", {}, 1],
    ["/api/generateocr/", { full_scan: false }, 18],
    ["/api/generateocr/", { full_scan: true }, 18],
  ] as const)("POST %s %o answers {status, job_id} and queues a visible job", async (path, body, jobType) => {
    const res = await call(ROLE, { method: "POST", path, body });
    expect(res.status).toBe(200);
    const parsed = expectSchema(JobResponse, res.body);
    expect(parsed.status).toBe(true);
    const job = await jobByUuid(parsed.job_id);
    expect(job.job_type).toBe(jobType);
    expect(job.started_by.username).toBe(ROLE);
    // Clean up so the queue and later cases are not affected.
    if (!job.finished) {
      const cancelled = await call(ROLE, { method: "POST", path: `/api/jobs/${job.id}/cancel/`, body: {} });
      expect([200, 400]).toContain(cancelled.status);
    }
  });

  it("POST /api/deletemissingphotos (no slash, as the frontend writes it)", async () => {
    const res = await call(ROLE, { method: "POST", path: "/api/deletemissingphotos", body: {} });
    expect(res.status).toBe(200);
    const parsed = expectSchema(DeleteMissingPhotosResponse, res.body);
    const job = await jobByUuid(parsed.job_id!);
    expect(job.job_type).toBe(5);
    if (!job.finished) await call(ROLE, { method: "POST", path: `/api/jobs/${job.id}/cancel/`, body: {} });
  });
});

describe.skipIf(!hasBase)("authz: job-starting buttons", () => {
  const cases: AuthzCase[] = [
    { name: "scan", req: { method: "POST", path: "/api/scanphotos/", body: {} } },
    { name: "full scan", req: { method: "POST", path: "/api/fullscanphotos/", body: {} } },
    { name: "delete missing", req: { method: "POST", path: "/api/deletemissingphotos", body: {} } },
    { name: "ocr", req: { method: "POST", path: "/api/generateocr/", body: { full_scan: false } } },
  ].map(c => ({ ...c, roles: ["anonymous"], expect: { anonymous: 401 } }) as AuthzCase);

  it("anonymous is refused everywhere, like the reference", async () => {
    const matrix = await authzMatrix(cases);
    for (const c of cases) expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
