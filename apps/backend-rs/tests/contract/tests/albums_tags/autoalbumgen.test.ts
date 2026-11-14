// "Generate event albums" (useGenerateAutoAlbumsMutation): POST /autoalbumgen/
// starts a job; the frontend only needs a 2xx. The job runs on the server
// under test only (the Rust worker picks it up at once), started as dave,
// whose one photo no other case depends on.
import { JobDetail } from "@fe/jobs/types";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { expectSchema } from "../../src/schema";
import { JobResponse } from "../../src/schemas/jobs_zip_services";

describe.skipIf(!hasBase)("POST /api/autoalbumgen/ (contract, server under test)", () => {
  it("answers {status, job_id} for a job the jobs page lists", async () => {
    const res = await call("dave", { method: "POST", path: "/api/autoalbumgen/", body: {} });
    expect(res.status).toBe(200);
    const parsed = expectSchema(JobResponse, res.body);
    expect(parsed.status).toBe(true);
    const list = await call<{ results: { id: number; job_id: string }[] }>("dave", {
      path: "/api/jobs/",
      query: { page_size: 50, page: 1 },
    });
    const row = list.body.results.find(j => j.job_id === parsed.job_id);
    expect(row, "job listed").toBeDefined();
    const job = expectSchema(JobDetail, (await call("dave", { path: `/api/jobs/${row!.id}/` })).body);
    expect(job.started_by.username).toBe("dave");
  });
});

describe.skipIf(!hasBase)("authz: POST /api/autoalbumgen/", () => {
  const c: AuthzCase = {
    name: "generate auto albums",
    req: { method: "POST", path: "/api/autoalbumgen/", body: {} },
    roles: ["anonymous"],
    expect: { anonymous: 401 },
  };

  it("anonymous is refused like the reference", async () => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
