// Dashboards: /stats/, /photomonthcounts/, /wordcloud/, /socialgraph/,
// /locationsunburst/, /locationtimeline/ (api_client/stats).
import { CountStats, LocationSunburst, LocationTimeline, PhotoMonthCountResponse, WordCloudResponse } from "@fe/stats/types";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import type { Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { PersonDataPointList } from "../../src/schemas/stats_admin_stacks_dupes";
import { expectTwin } from "../../src/twin";

const OWNERS: Role[] = ["alice", "bob", "admin", "dave"];

describe.skipIf(!hasBase)("stats dashboards", () => {
  it("contract: every dashboard parses for alice", async () => {
    const counts = expectSchema(CountStats, (await call("alice", { path: "/api/stats/" })).body);
    expect(counts.num_photos).toBeGreaterThan(0);
    expect(expectSchema(PhotoMonthCountResponse, (await call("alice", { path: "/api/photomonthcounts/" })).body).length).toBeGreaterThan(0);
    const cloud = expectSchema(WordCloudResponse, (await call("alice", { path: "/api/wordcloud/" })).body);
    expect(cloud.people.length).toBeGreaterThan(0);
    const graph = expectSchema(PersonDataPointList, (await call("alice", { path: "/api/socialgraph/" })).body);
    expect(graph.nodes.length).toBeGreaterThan(1);
    const tree = expectSchema(LocationSunburst, (await call("alice", { path: "/api/locationsunburst/" })).body);
    expect(tree.children?.length).toBeGreaterThan(0);
    expect(expectSchema(LocationTimeline, (await call("alice", { path: "/api/locationtimeline/" })).body).length).toBeGreaterThan(0);
  });

  it.each(OWNERS)("twin: /stats/ as %s", async role => {
    await expectTwin(role, { path: "/api/stats/" }, { project: [] });
  });

  it.each(OWNERS)("twin: /photomonthcounts/ as %s", async role => {
    await expectTwin(role, { path: "/api/photomonthcounts/" }, { project: [] });
  });

  it.each(OWNERS)("twin: /wordcloud/ as %s", async role => {
    // Django iterates a Python set for the location labels and leaves ties
    // between people to Postgres: those two lists are compared unordered.
    await expectTwin(role, { path: "/api/wordcloud/" }, { project: [], unordered: ["locations", "people"], refStable: false });
  });

  it.each(OWNERS)("twin: /socialgraph/ as %s", async role => {
    // Same numpy seed and node order: coordinates agree; link order follows a
    // Python set.
    await expectTwin(role, { path: "/api/socialgraph/" }, { project: [], unordered: ["links"], epsilon: 1e-9 });
  });

  it.each(OWNERS)("twin: /locationsunburst/ as %s", async role => {
    // `hex` is random.choice(palette) on both sides.
    await expectTwin(
      role,
      { path: "/api/locationsunburst/" },
      {
        project: [
          "name",
          "children[].name",
          "children[].children[].name",
          "children[].children[].children[].name",
          "children[].children[].children[].value",
        ],
      },
    );
  });

  it("sunburst colours come from the hls palette", async () => {
    const tree = (await call("alice", { path: "/api/locationsunburst/" })).body as { children: { hex: string }[] };
    for (const c of tree.children) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(OWNERS)("twin: /locationtimeline/ as %s", async role => {
    await expectTwin(role, { path: "/api/locationtimeline/" }, { project: [] });
  });
});

describe.skipIf(!hasBase)("authz: stats dashboards", () => {
  const cases: AuthzCase[] = [
    "/api/stats/",
    "/api/photomonthcounts/",
    "/api/wordcloud/",
    "/api/socialgraph/",
    "/api/locationsunburst/",
    "/api/locationtimeline/",
  ].map(path => ({ name: path, req: { path }, expect: { alice: 200, bob: 200, anonymous: 401 } }));
  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
