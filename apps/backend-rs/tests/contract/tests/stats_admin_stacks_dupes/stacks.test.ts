// Photo stacks, read side plus every request that must not change state
// (validation errors, other users). Mutations run in mutations.test.ts.
import {
  DetectStacksResponseSchema,
  StackDetailResponseSchema,
  StackListResponseSchema,
  StackStatsResponseSchema,
} from "@fe/stacks/types";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { manifest, photo, type Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

const burst = () => manifest().stacks.burst.id;
const manual = () => manifest().stacks.manual.id;
const ROLES: Role[] = ["alice", "bob", "admin"];

describe.skipIf(!hasBase)("stacks: reads", () => {
  it("contract: list, detail and stats parse", async () => {
    const list = expectSchema(StackListResponseSchema, (await call("alice", { path: "/api/stacks", query: { page: 1, page_size: 20 } })).body);
    expect(list.count).toBe(2);
    for (const id of [burst(), manual()]) {
      const detail = expectSchema(StackDetailResponseSchema, (await call("alice", { path: `/api/stacks/${id}/` })).body);
      expect(detail.photos.length).toBe(detail.photo_count);
    }
    const stats = expectSchema(StackStatsResponseSchema, (await call("alice", { path: "/api/stacks/stats/" })).body);
    expect(stats.total_stacks).toBe(2);
  });

  it.each([
    ["first page", { page: 1, page_size: 20 }],
    ["no params", {}],
    ["burst only", { stack_type: "burst" }],
    ["legacy type ignored", { stack_type: "raw_jpeg" }],
    ["page past the end", { page: 9, page_size: 1 }],
    ["junk paging", { page: "x", page_size: "0" }],
    ["page size capped", { page_size: 500, ordering: "-created_at" }],
  ] as const)("twin: list, %s", async (_name, query) => {
    for (const role of ROLES) {
      await expectTwin(role, { path: "/api/stacks", query }, { project: [], unordered: ["results[].preview_photos"] });
    }
  });

  it("twin: detail and stats", async () => {
    for (const id of [burst(), manual()]) {
      await expectTwin("alice", { path: `/api/stacks/${id}/` }, { project: [], unordered: ["photos", "photos[].file_variants"] });
    }
    for (const role of ROLES) await expectTwin(role, { path: "/api/stacks/stats/" }, { project: [] });
  });
});

describe.skipIf(!hasBase)("authz: stacks", () => {
  const h = (k: string) => photo(k).image_hash;
  const others: Role[] = ["admin", "bob", "carol", "dave", "anonymous"];
  const cases: AuthzCase[] = [
    { name: "list", req: { path: "/api/stacks" }, expect: { alice: 200, bob: 200, anonymous: 401 } },
    { name: "stats", req: { path: "/api/stacks/stats/" }, expect: { alice: 200, anonymous: 401 } },
    { name: "detail", req: { path: `/api/stacks/${burst()}/` }, expect: { alice: 200, bob: 404, admin: 404, anonymous: 401 } },
    { name: "detail of a missing stack", req: { path: "/api/stacks/00000000-0000-0000-0000-000000000000/" }, expect: { alice: 404 } },
    {
      name: "primary without photo_hash",
      req: { method: "POST", path: `/api/stacks/${burst()}/primary/`, body: {} },
      expect: { alice: 400, bob: 404, anonymous: 401 },
    },
    {
      name: "primary with a photo outside the stack",
      req: { method: "POST", path: `/api/stacks/${burst()}/primary/`, body: { photo_hash: h("alice/e2e_01") } },
      expect: { alice: 400, dave: 404 },
    },
    {
      name: "remove without photo_hashes",
      req: { method: "POST", path: `/api/stacks/${burst()}/remove/`, body: { photo_hashes: [] } },
      expect: { alice: 400, carol: 404, anonymous: 401 },
    },
    {
      name: "remove someone else's photos",
      roles: others,
      req: { method: "POST", path: `/api/stacks/${burst()}/remove/`, body: { photo_hashes: [h("alice/burst_1")] } },
      expect: { bob: 404 },
    },
    {
      name: "delete someone else's stack",
      roles: others,
      req: { method: "DELETE", path: `/api/stacks/${burst()}/` },
      expect: { bob: 404, admin: 404, anonymous: 401 },
    },
    {
      name: "manual with one photo",
      req: { method: "POST", path: "/api/stacks/manual/", body: { photo_hashes: [h("alice/e2e_01"), h("alice/e2e_01")] } },
      expect: { alice: 400, anonymous: 401 },
    },
    {
      name: "manual with alice's photos as another user",
      roles: others,
      req: { method: "POST", path: "/api/stacks/manual/", body: { photo_hashes: [h("alice/e2e_01"), h("alice/e2e_02")] } },
      expect: { bob: 400 },
    },
    {
      name: "merge without photo_hashes",
      req: { method: "POST", path: "/api/stacks/merge/", body: {} },
      expect: { alice: 400, anonymous: 401 },
    },
    {
      name: "merge photos in no manual stack",
      req: { method: "POST", path: "/api/stacks/merge/", body: { photo_hashes: [h("alice/burst_2")] } },
      expect: { alice: 400, bob: 400 },
    },
    { name: "detect", roles: ["anonymous"], req: { method: "POST", path: "/api/stacks/detect/", body: {} }, expect: { anonymous: 401 } },
  ];
  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });

  it("twin: merge of a single manual stack needs no merge", async () => {
    await expectTwin(
      "alice",
      { method: "POST", path: "/api/stacks/merge/", body: { photo_hashes: [photo("alice/manual_a").image_hash] } },
      { project: [], refStable: false },
    );
  });

  it("contract + twin: detect queues a job", async () => {
    const res = await call("bob", { method: "POST", path: "/api/stacks/detect/", body: { detect_bursts: false } });
    expect(res.status).toBe(202);
    expectSchema(DetectStacksResponseSchema, res.body);
    await expectTwin("bob", { method: "POST", path: "/api/stacks/detect/", body: {} }, { project: [], refStable: false });
  });
});
