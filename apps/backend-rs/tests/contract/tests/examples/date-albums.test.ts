// The timeline parses GET /albums/date/list/ with this schema (useFetchDateAlbumsQuery).
import { FetchDateAlbumsListResponse } from "@fe/albums/types";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { manifest } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

// Group fields the timeline reads (03 §4). Items are empty in the list.
const GROUP_PROJECTION = ["results[].id", "results[].date", "results[].location", "results[].numberOfItems", "results[].incomplete"];

describe.skipIf(!hasBase)("GET /api/albums/date/list/", () => {
  it("contract: alice's timeline parses and has one group per visible date", async () => {
    const res = await call("alice", { path: "/api/albums/date/list/?" });
    expect(res.status).toBe(200);
    const { results } = expectSchema(FetchDateAlbumsListResponse, res.body);
    const aliceDates = manifest().albums.date.filter(d => d.owner === "alice");
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(aliceDates.length);
    for (const group of results) {
      expect(group.items).toEqual([]);
      expect(group.incomplete).toBe(true);
    }
  });

  it.each([
    ["timeline", {}],
    ["favorites", { favorite: "true" }],
    ["hidden", { hidden: "true" }],
    ["trash", { in_trashcan: "true" }],
    ["videos", { video: "true" }],
    ["screenshots", { is_screenshot: "true" }],
    ["public", { public: "true" }],
  ] as const)("twin: %s filter", async (_name, query) => {
    await expectTwin("alice", { path: "/api/albums/date/list/", query }, { project: GROUP_PROJECTION });
  });

  it("twin: a person's timeline", async () => {
    const anna = manifest().persons.anna!;
    await expectTwin("alice", { path: "/api/albums/date/list/", query: { person: anna.id } }, { project: GROUP_PROJECTION });
  });

  it("twin: every role sees its own timeline", async () => {
    for (const role of ["admin", "bob", "carol", "dave"] as const) {
      await expectTwin(role, { path: "/api/albums/date/list/" }, { project: GROUP_PROJECTION });
    }
  });
});

describe.skipIf(!hasBase)("authz: date albums", () => {
  const cases: AuthzCase[] = [
    { name: "date list", req: { path: "/api/albums/date/list/" }, expect: { alice: 200, anonymous: 401 } },
    {
      name: "public user's timeline (username filter)",
      req: { path: "/api/albums/date/list/", query: { username: "alice", public: "true" } },
    },
  ];

  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
