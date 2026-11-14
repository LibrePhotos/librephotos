// Zip downloads (useDownloadPhotosMutation): start, poll every 3 s, delete.
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { category, manifest, photo } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { DownloadResponse, DownloadStatusResponse } from "../../src/schemas/jobs_zip_services";
import { expectTwin } from "../../src/twin";

const jobs = () => manifest().jobs;

describe.skipIf(!hasBase)("POST /api/photos/download (server under test)", () => {
  it("contract: starts a job, the worker builds the archive, the poll reports SUCCESS, delete removes it", async () => {
    const hashes = ["alice/e2e_01", "alice/e2e_02"].map(k => photo(k).image_hash);
    const res = await call("alice", {
      method: "POST",
      path: "/api/photos/download",
      body: { image_hashes: hashes, include_stacked_photos: false },
    });
    expect(res.status).toBe(200);
    const { job_id, url } = expectSchema(DownloadResponse, res.body);

    let status = "PENDING";
    for (let i = 0; i < 60 && status !== "SUCCESS"; i++) {
      const poll = await call("alice", { path: `/api/photos/download?job_id=${job_id}` });
      status = expectSchema(DownloadStatusResponse, poll.body).status;
      expect(status).not.toBe("FAILURE");
      expect([200, 202]).toContain(poll.status);
      if (status !== "SUCCESS") await new Promise(r => setTimeout(r, 500));
    }
    expect(status).toBe("SUCCESS");
    // Only the starter may poll.
    expect((await call("bob", { path: `/api/photos/download?job_id=${job_id}` })).status).toBe(404);

    const del = await call("alice", { method: "DELETE", path: `/api/delete/zip/${url}` });
    expect(del.status).toBe(200);
  });

  it("contract: select_all with a query and include_stacked_photos", async () => {
    const res = await call("alice", {
      method: "POST",
      path: "/api/photos/download",
      body: { select_all: true, query: { video: true }, excluded_hashes: [], include_stacked_photos: true },
    });
    expect(res.status).toBe(200);
    expectSchema(DownloadResponse, res.body);
  });
});

describe.skipIf(!hasBase)("zip: refusals (twin)", () => {
  it("POST without image_hashes is 400", async () => {
    await expectTwin("alice", { method: "POST", path: "/api/photos/download", body: {} }, { project: ["*"], refStable: false });
  });

  it("POST with someone else's hashes is 404 'No photos found'", async () => {
    const bobs = category("same_file_two_users")
      .filter(p => p.owner === "bob")
      .map(p => p.image_hash);
    expect(bobs.length).toBeGreaterThan(0);
    await expectTwin(
      "alice",
      { method: "POST", path: "/api/photos/download", body: { image_hashes: bobs } },
      { project: ["*"], refStable: false },
    );
  });

  it("select_all whose query matches nothing is 404", async () => {
    await expectTwin(
      "alice",
      {
        method: "POST",
        path: "/api/photos/download",
        body: { select_all: true, query: { video: true }, excluded_hashes: category("video").map(p => p.image_hash) },
      },
      { project: ["*"], refStable: false },
    );
  });

  it("GET without job_id is 400", async () => {
    await expectTwin("alice", { path: "/api/photos/download" }, { project: ["*"] });
  });

  it.each([
    ["alice", "running"],
    ["alice", "failed"],
    ["admin", "finished"],
    ["bob", "running"],
    ["admin", "running"],
  ] as const)("GET ?job_id= as %s for the %s fixture job", async (role, which) => {
    await expectTwin(role, { path: "/api/photos/download", query: { job_id: jobs()[which].job_id } }, { project: ["*"] });
  });

  it("DELETE of an absent archive is still 200; a non-UUID is 404", async () => {
    await expectTwin("alice", { method: "DELETE", path: "/api/delete/zip/0f8fad5b-d9cb-469f-a165-70867728950e" }, { project: [] });
    await expectTwin("alice", { method: "DELETE", path: "/api/delete/zip/0F8FAD5B-D9CB-469F-A165-70867728950E/" }, { project: [] });
  });
});

describe.skipIf(!hasBase)("authz: zip", () => {
  const cases: AuthzCase[] = [
    {
      name: "start",
      req: { method: "POST", path: "/api/photos/download", body: {} },
      roles: ["alice", "anonymous"],
      expect: { alice: 400, anonymous: 401 },
    },
    {
      name: "poll alice's job",
      req: { path: "/api/photos/download", query: { job_id: "d10a4cfc-8dcc-4ea5-9b2a-09e9d4f7350b" } },
    },
    {
      name: "delete zip",
      req: { method: "DELETE", path: "/api/delete/zip/0f8fad5b-d9cb-469f-a165-70867728950e" },
      expect: { bob: 200, anonymous: 401 },
    },
    { name: "delete junk", req: { method: "DELETE", path: "/api/delete/zip/nope" }, roles: ["alice"], expect: { alice: 404 } },
  ];

  it("matrix matches the reference", async () => {
    cases[1]!.req.query = { job_id: jobs().running.job_id };
    const matrix = await authzMatrix(cases);
    for (const c of cases) expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
