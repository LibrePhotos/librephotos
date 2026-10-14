// Server & admin: /storagestats/, /imagetag/ (every page), /serverstats/,
// /serverlogs (blob), /serverlogs/view?lines= (api_client/server).
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { BASE_URL, hasBase, REF_URL } from "../../src/env";
import { expectSchema } from "../../src/schema";
import {
  ImageTagResponse,
  ServerLogsViewResponse,
  ServerStatsResponse,
  StorageStatsResponse,
} from "../../src/schemas/stats_admin_stacks_dupes";
import { expectTwin } from "../../src/twin";

describe.skipIf(!hasBase)("server info", () => {
  it("contract: storage stats and image tag parse for every signed-in role", async () => {
    for (const role of ["alice", "bob", "admin"] as const) {
      const s = expectSchema(StorageStatsResponse, (await call(role, { path: "/api/storagestats/" })).body);
      expect(s.total_storage).toBeGreaterThan(0);
      expectSchema(ImageTagResponse, (await call(role, { path: "/api/imagetag/" })).body);
    }
  });

  it("twin: storage stats (free space moves while the suite runs)", async () => {
    await expectTwin("alice", { path: "/api/storagestats/" }, { project: [], epsilon: 1e-3, refStable: false });
  });

  it("twin: image tag", async () => {
    await expectTwin("alice", { path: "/api/imagetag/" }, { project: [] });
  });

  it("contract: server stats parse for the admin", async () => {
    const res = await call("admin", { path: "/api/serverstats/" });
    expect(res.status).toBe(200);
    const stats = expectSchema(ServerStatsResponse, res.body);
    expect(stats.users.length).toBe(stats.number_of_users);
  });

  it("twin: per-user server stats", async () => {
    // Machine figures (CPU, RAM, disk, GPU) come from different probes.
    await expectTwin(
      "admin",
      { path: "/api/serverstats/" },
      { project: ["number_of_users", "users[].*", "image_tag"], unordered: ["users"] },
    );
  });

  it("contract + twin: log tail", async () => {
    const res = await call("admin", { path: "/api/serverlogs/view", query: { lines: 5 } });
    if (res.status === 200) expectSchema(ServerLogsViewResponse, res.body);
    await expectTwin("admin", { path: "/api/serverlogs/view", query: { lines: 1 } }, { project: ["count"] });
    // How many lines there are depends on what each server has logged; a bad
    // `lines` must fall back to the 100-line default on both.
    for (const base of [REF_URL, BASE_URL]) {
      const all = await call<{ count: number }>("admin", { path: "/api/serverlogs/view", query: { lines: 1000 } }, base);
      const junk = await call<{ count: number }>("admin", { path: "/api/serverlogs/view", query: { lines: "junk" } }, base);
      expect(junk.status, base).toBe(all.status);
      if (all.status !== 200) continue;
      expect(junk.body.count, base).toBeLessThanOrEqual(100);
      expect(junk.body.count, base).toBeGreaterThanOrEqual(Math.min(100, all.body.count));
    }
  });

  it("twin: log download is an attachment", async () => {
    const ref = await call("admin", { path: "/api/serverlogs" }, REF_URL);
    const actual = await call("admin", { path: "/api/serverlogs" }, BASE_URL);
    expect(actual.status).toBe(ref.status);
    expect(actual.headers.get("content-disposition")).toBe(ref.headers.get("content-disposition"));
    if (ref.status === 200) expect(actual.text.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasBase)("authz: server info", () => {
  const cases: AuthzCase[] = [
    { name: "storagestats", req: { path: "/api/storagestats/" }, expect: { alice: 200, anonymous: 401 } },
    { name: "imagetag", req: { path: "/api/imagetag/" }, expect: { alice: 200, anonymous: 401 } },
    { name: "serverstats", req: { path: "/api/serverstats/" }, expect: { admin: 200, alice: 403, anonymous: 401 } },
    { name: "serverlogs", req: { path: "/api/serverlogs" }, expect: { alice: 403, anonymous: 401 } },
    { name: "serverlogs view", req: { path: "/api/serverlogs/view", query: { lines: 3 } }, expect: { admin: 200, bob: 403, anonymous: 401 } },
  ];
  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
