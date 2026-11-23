// Duplicate groups, read side plus requests that must not change state.
// The frontend types these responses without validating them, so the
// schemas are the ones it declares in api_client/duplicates/types.ts.
import { DetectDuplicatesResponse, DuplicateDetail, DuplicateListResponse, DuplicateStats } from "@fe/duplicates/types";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { manifest, photo, type Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

const dup = () => manifest().duplicates.visual.id;
const ROLES: Role[] = ["alice", "bob", "admin"];

describe.skipIf(!hasBase)("duplicates: reads", () => {
  it("contract: list, detail and stats", async () => {
    const list = expectSchema(DuplicateListResponse, (await call("alice", { path: "/api/duplicates", query: { page: 1, page_size: 20 } })).body);
    expect(list.count).toBe(1);
    // is_kept is null (not a boolean) until the group is resolved, as on Django.
    const raw = (await call("alice", { path: `/api/duplicates/${dup()}` })).body as { photos: { is_kept: unknown }[] };
    expect(raw.photos.every(p => p.is_kept === null)).toBe(true);
    const detail = expectSchema(DuplicateDetail, { ...raw, photos: raw.photos.map(p => ({ ...p, is_kept: false })) });
    expect(detail.suggested_photo_hash).not.toBeNull();
    const stats = expectSchema(DuplicateStats, (await call("alice", { path: "/api/duplicates/stats" })).body);
    expect(stats.pending_duplicates).toBe(1);
  });

  it.each([
    ["no params", {}],
    ["pending visual", { status: "pending", duplicate_type: "visual_duplicate" }],
    ["resolved", { status: "resolved" }],
    ["exact", { duplicate_type: "exact_copy", page_size: 1 }],
    ["page past the end", { page: 3 }],
  ] as const)("twin: list, %s", async (_name, query) => {
    for (const role of ROLES) {
      await expectTwin(role, { path: "/api/duplicates", query }, { project: [], unordered: ["results[].preview_photos"] });
    }
  });

  it("twin: detail and stats", async () => {
    await expectTwin("alice", { path: `/api/duplicates/${dup()}` }, { project: [], unordered: ["photos"] });
    for (const role of ROLES) await expectTwin(role, { path: "/api/duplicates/stats" }, { project: [] });
  });
});

describe.skipIf(!hasBase)("authz: duplicates", () => {
  const others: Role[] = ["admin", "bob", "carol", "dave", "anonymous"];
  const keep = () => photo("alice/dup_original").image_hash;
  const cases: AuthzCase[] = [
    { name: "list", req: { path: "/api/duplicates" }, expect: { alice: 200, dave: 200, anonymous: 401 } },
    { name: "stats", req: { path: "/api/duplicates/stats" }, expect: { alice: 200, anonymous: 401 } },
    { name: "detail", req: { path: `/api/duplicates/${dup()}` }, expect: { alice: 200, bob: 404, admin: 404, anonymous: 401 } },
    {
      name: "resolve without keep_photo_hash",
      req: { method: "POST", path: `/api/duplicates/${dup()}/resolve`, body: {} },
      expect: { alice: 400, bob: 404, anonymous: 401 },
    },
    {
      name: "resolve keeping a photo outside the group",
      req: { method: "POST", path: `/api/duplicates/${dup()}/resolve`, body: { keep_photo_hash: photo("alice/e2e_01").image_hash } },
      expect: { alice: 400 },
    },
    {
      name: "resolve someone else's group",
      roles: others,
      req: { method: "POST", path: `/api/duplicates/${dup()}/resolve`, body: { keep_photo_hash: keep() } },
      expect: { bob: 404, anonymous: 401 },
    },
    {
      name: "revert a pending group",
      req: { method: "POST", path: `/api/duplicates/${dup()}/revert`, body: {} },
      expect: { alice: 400, bob: 404, anonymous: 401 },
    },
    { name: "dismiss someone else's group", roles: others, req: { method: "POST", path: `/api/duplicates/${dup()}/dismiss`, body: {} }, expect: { dave: 404 } },
    { name: "delete someone else's group", roles: others, req: { method: "DELETE", path: `/api/duplicates/${dup()}/delete` }, expect: { carol: 404 } },
    { name: "detect", roles: ["anonymous"], req: { method: "POST", path: "/api/duplicates/detect", body: {} }, expect: { anonymous: 401 } },
  ];
  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });

  it("contract + twin: detect queues a job and echoes the options", async () => {
    const body = { detect_exact_copies: false, visual_threshold: 7, batch_size: 5, clear_pending: false };
    const res = await call("dave", { method: "POST", path: "/api/duplicates/detect", body });
    expect(res.status).toBe(202);
    expectSchema(DetectDuplicatesResponse, res.body);
    await expectTwin("dave", { method: "POST", path: "/api/duplicates/detect", body }, { project: [], refStable: false });
  });
});
