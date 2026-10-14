// Sharing: GET /api/photos/shared/tome/ (useFetchSharedPhotosWithMeQuery) and
// GET /api/photos/shared/fromme/ (useFetchSharedPhotosByMeQuery).
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { category, type Role, user } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { SharedPhotosByMeResponse, SharedPhotosWithMeResponse } from "../../src/schemas/search_sharing_public";
import { expectTwin } from "../../src/twin";

const PIG = [
  "id",
  "image_hash",
  "url",
  "aspectRatio",
  "dominantColor",
  "type",
  "video_length",
  "rating",
  "date",
  "birthTime",
  "location",
  "owner",
  "exif_gps_lat",
  "exif_gps_lon",
  "removed",
  "in_trashcan",
  "stacks[].id",
  "stacks[].type",
  "stacks[].is_primary",
  "has_raw_variant",
  "local_orientation",
];
const PAGE = ["count", "next", "previous"];
const TOME = [...PAGE, ...PIG.map(f => `results[].${f}`)];
const FROMME = [...PAGE, "results[].user_id", "results[].user", ...PIG.map(f => `results[].photo.${f}`)];
const ROLES: Role[] = ["admin", "alice", "bob", "carol", "dave"];

describe.skipIf(!hasBase)("GET /api/photos/shared/tome/", () => {
  it("contract: bob sees the photos shared to him, with their owner", async () => {
    const res = await call("bob", { path: "/api/photos/shared/tome/" });
    expect(res.status).toBe(200);
    const { results } = expectSchema(SharedPhotosWithMeResponse, res.body);
    const shared = category("shared_to_bob").filter(p => !p.hidden && !p.in_trashcan && !p.removed);
    expect(results.map(r => r.id).sort()).toEqual(shared.map(p => p.id).sort());
    for (const r of results) expect(r.owner?.id).toBe(user("alice").id);
  });

  it.each(ROLES)("twin (%s)", async role => {
    await expectTwin(role, { path: "/api/photos/shared/tome/" }, { project: TOME, unordered: ["results"] });
  });

  it.each([
    ["first page of one", { page_size: "1" }],
    ["second page of one", { page_size: "1", page: "2" }],
    ["past the end", { page_size: "1", page: "9" }],
    ["junk page", { page: "x" }],
    ["last page", { page_size: "1", page: "last" }],
    ["junk page size falls back", { page_size: "x" }],
  ] as const)("twin (bob): pagination, %s", async (_name, query) => {
    await expectTwin("bob", { path: "/api/photos/shared/tome/", query }, { project: [...TOME, "errors"] });
  });
});

describe.skipIf(!hasBase)("GET /api/photos/shared/fromme/", () => {
  it("contract: alice's shares parse, one row per (photo, recipient)", async () => {
    const res = await call("alice", { path: "/api/photos/shared/fromme/" });
    expect(res.status).toBe(200);
    const { results } = expectSchema(SharedPhotosByMeResponse, res.body);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.user.id).toBe(r.user_id);
      expect(r.photo.owner?.id).toBe(user("alice").id);
    }
  });

  it.each(ROLES)("twin (%s)", async role => {
    await expectTwin(role, { path: "/api/photos/shared/fromme/" }, { project: FROMME, unordered: ["results"] });
  });

  it("twin (alice): second page of one", async () => {
    await expectTwin("alice", { path: "/api/photos/shared/fromme/", query: { page_size: "1", page: "2" } }, {
      project: FROMME,
    });
  });
});

describe.skipIf(!hasBase)("authz: shared photo lists", () => {
  const cases: AuthzCase[] = [
    { name: "tome", req: { path: "/api/photos/shared/tome/" }, expect: { bob: 200, anonymous: 401 } },
    { name: "fromme", req: { path: "/api/photos/shared/fromme/" }, expect: { alice: 200, anonymous: 401 } },
  ];
  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
