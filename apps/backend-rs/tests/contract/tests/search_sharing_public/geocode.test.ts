// GET /api/geocode/search?q= (useGeocodeSearchQuery): a bare array.
import { GeocodeSearchResponseSchema } from "@fe/geocode/types";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

// Hitting the real geocoder (public Nominatim by default) is opt-in.
const network = process.env.LP_NETWORK_TESTS === "1";

describe.skipIf(!hasBase)("GET /api/geocode/search", () => {
  it("contract: an empty query is an empty array", async () => {
    const res = await call("alice", { path: "/api/geocode/search?q=" });
    expect(res.status).toBe(200);
    expect(expectSchema(GeocodeSearchResponseSchema, res.body)).toEqual([]);
  });

  it.each([
    ["no q at all", "/api/geocode/search"],
    ["blank q", "/api/geocode/search?q=%20%20"],
  ])("twin: %s", async (_name, path) => {
    await expectTwin("alice", { path }, { project: ["*"] });
  });

  it.skipIf(!network)("twin (network): a real place", async () => {
    const { actual } = await expectTwin(
      "alice",
      { path: `/api/geocode/search?q=${encodeURIComponent("Brandenburger Tor")}&limit=2` },
      { project: ["*"], refStable: false, epsilon: 1e-9 },
    );
    expect(expectSchema(GeocodeSearchResponseSchema, actual.body).length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasBase)("authz: geocode", () => {
  const cases: AuthzCase[] = [
    { name: "empty query", req: { path: "/api/geocode/search?q=" }, expect: { alice: 200, anonymous: 401 } },
    // Django's int(limit) raises: a 500 for every signed-in user.
    { name: "junk limit", req: { path: "/api/geocode/search?q=x&limit=abc" }, expect: { alice: 500, anonymous: 401 } },
  ];
  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
