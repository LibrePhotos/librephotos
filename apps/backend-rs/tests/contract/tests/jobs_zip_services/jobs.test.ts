// The jobs page (JobList, JobDetailView) and the worker indicator
// (useWorkerQuery, polled every 2 s).
import { CancelJobResponse, JobDetail, JobsResponse, WorkerAvailabilityResponse } from "@fe/jobs/types";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { manifest, type Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

const PAGE = ["count", "next", "previous", "results[].*", "results[].started_by.*"];
const JOB = ["*"];
const jobs = () => manifest().jobs;

describe.skipIf(!hasBase)("GET /api/jobs/", () => {
  it.each([
    ["alice", {}],
    ["admin", {}],
    ["admin", { mine: "true" }],
    ["bob", {}],
  ] as const)("contract: %s %o parses as JobsResponse", async (role, extra) => {
    const res = await call(role, { path: "/api/jobs/", query: { page_size: 10, page: 1, ...extra } });
    expect(res.status).toBe(200);
    const body = expectSchema(JobsResponse, res.body);
    for (const job of body.results) expectSchema(JobDetail, job);
  });

  // Django orders by started_at alone, and the fixture's jobs share started_at
  // values, so Postgres returns ties in an arbitrary order: compare whole
  // lists as sets, and pages only by their envelope.
  it.each([
    ["alice", { page_size: 50, page: 1 }],
    ["admin", { page_size: 50, page: 1 }],
    ["admin", { page_size: 50, page: 1, mine: "true" }],
    ["alice", { page_size: 50, page: 1, mine: "false" }],
    ["bob", { page_size: 50, page: 1 }],
    ["dave", { page_size: 10 }],
    ["alice", { page_size: 500 }],
  ] as const)("twin: %s %o", async (role, query) => {
    await expectTwin(role, { path: "/api/jobs/", query }, { project: PAGE, unordered: ["results"] });
  });

  it.each([
    ["alice", { page_size: 2, page: 2 }],
    ["admin", { page_size: 2, page: 1 }],
    ["admin", { page_size: 3, page: 3 }],
    ["admin", { page_size: 2, page: "last" }],
  ] as const)("twin: page envelope %s %o", async (role, query) => {
    await expectTwin(role, { path: "/api/jobs/", query }, { project: ["count", "next", "previous"] });
  });

  it("twin: page 0 and a page past the end are 404 (DRF 'Invalid page.')", async () => {
    for (const page of [0, 99, "x"]) {
      await expectTwin("alice", { path: "/api/jobs/", query: { page_size: 10, page } }, { project: ["errors[].*"] });
    }
  });
});

describe.skipIf(!hasBase)("GET /api/jobs/{id}/", () => {
  it.each([
    ["alice", "running"],
    ["alice", "failed"],
    ["admin", "finished"],
    ["admin", "running"],
  ] as const)("contract + twin: %s reads the %s job", async (role, which) => {
    const req = { path: `/api/jobs/${jobs()[which].id}/` };
    const res = await call(role, req);
    expect(res.status).toBe(200);
    expectSchema(JobDetail, res.body);
    await expectTwin(role, req, { project: JOB });
  });

  it("twin: someone else's job and a junk id are 404", async () => {
    await expectTwin("bob", { path: `/api/jobs/${jobs().running.id}/` }, { project: ["errors[].*"] });
    await expectTwin("alice", { path: `/api/jobs/${jobs().finished.id}/` }, { project: ["errors[].*"] });
    await expectTwin("alice", { path: "/api/jobs/abc/" }, { project: ["errors[].*"] });
  });
});

describe.skipIf(!hasBase)("GET /api/rqavailable/", () => {
  it.each(["admin", "alice", "bob", "dave"] as const)("contract + twin as %s", async role => {
    const res = await call(role, { path: "/api/rqavailable/" });
    expect(res.status).toBe(200);
    expectSchema(WorkerAvailabilityResponse, res.body);
    await expectTwin(role as Role, { path: "/api/rqavailable/" }, { project: ["*", "job_detail.*", "job_detail.started_by.*"] });
  });
});

describe.skipIf(!hasBase)("POST /api/jobs/{id}/cancel/ (read-only cases)", () => {
  it("twin: cancelling a finished job is a 400 with the frontend's CancelJobResponse", async () => {
    const req = { method: "POST" as const, path: `/api/jobs/${jobs().failed.id}/cancel/`, body: {} };
    const res = await call("alice", req);
    expect(res.status).toBe(400);
    expectSchema(CancelJobResponse, res.body);
    await expectTwin("alice", req, { project: ["*"] });
  });

  it("twin: another user's job is 404, before any state is touched", async () => {
    await expectTwin(
      "bob",
      { method: "POST", path: `/api/jobs/${jobs().running.id}/cancel/`, body: {} },
      { project: ["errors[].*"] },
    );
  });
});

describe.skipIf(!hasBase)("authz: jobs", () => {
  const cases = (): AuthzCase[] => [
    { name: "job list", req: { path: "/api/jobs/", query: { page_size: 10, page: 1 } }, expect: { alice: 200, anonymous: 401 } },
    {
      name: "alice's running job",
      req: { path: `/api/jobs/${jobs().running.id}/` },
      expect: { alice: 200, admin: 200, bob: 404, carol: 404, dave: 404, anonymous: 401 },
    },
    {
      name: "admin's finished job",
      req: { path: `/api/jobs/${jobs().finished.id}/` },
      expect: { admin: 200, alice: 404, anonymous: 401 },
    },
    { name: "worker availability", req: { path: "/api/rqavailable/" }, expect: { dave: 200, anonymous: 401 } },
    {
      name: "delete another user's job",
      req: { method: "DELETE", path: `/api/jobs/${jobs().running.id}/` },
      roles: ["bob", "carol", "dave", "anonymous"],
      expect: { bob: 404, anonymous: 401 },
    },
    {
      name: "cancel another user's job",
      req: { method: "POST", path: `/api/jobs/${jobs().running.id}/cancel/`, body: {} },
      roles: ["bob", "carol", "dave", "anonymous"],
      expect: { bob: 404, anonymous: 401 },
    },
  ];

  it("matrix matches the reference", async () => {
    const all = cases();
    const matrix = await authzMatrix(all);
    for (const c of all) expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
