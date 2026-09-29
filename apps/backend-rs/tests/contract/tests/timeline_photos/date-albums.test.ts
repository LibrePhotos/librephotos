// GET /albums/date/list/ and GET /albums/date/{id} (03 §4): the timeline.
// Parsed by useFetchDateAlbumsQuery / useFetchDateAlbumQuery with these schemas.
import { FetchDateAlbumResponse, FetchDateAlbumsListResponse } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { scanDirectory } from "../../src/live";
import { manifest, type Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

const GROUP = ["results[].id", "results[].date", "results[].location", "results[].incomplete", "results[].numberOfItems", "results[].items"];

// PigPhoto fields the grid reads (03 §4). Stack photo_count is left out on
// purpose: Django always reports 1 there (a prefetch bug), Rust the real count.
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
  "stacks[].id",
  "stacks[].type",
  "stacks[].is_primary",
  "has_raw_variant",
  "exif_gps_lat",
  "exif_gps_lon",
  "removed",
  "in_trashcan",
];
const PAGE = [
  "results.id",
  "results.date",
  "results.location",
  "results.incomplete",
  "results.numberOfItems",
  ...PIG.map(f => `results.items[].${f}`),
];

const FILTERS: [string, Record<string, string>][] = [
  ["timeline", {}],
  ["favorites", { favorite: "true" }],
  ["hidden", { hidden: "true" }],
  ["trash", { in_trashcan: "true" }],
  ["photos", { photo: "true" }],
  ["videos", { video: "true" }],
  ["screenshots", { is_screenshot: "true" }],
  ["photos+screenshots", { photo: "true", is_screenshot: "true" }],
  ["public", { public: "true" }],
  ["public of alice", { public: "true", username: "alice" }],
  ["all stack photos", { show_all_stack_photos: "true" }],
];

function aliceDays() {
  return manifest().albums.date.filter(d => d.owner === "alice");
}

describe.skipIf(!hasBase)("timeline_photos: GET /api/albums/date/list/", () => {
  it.each(FILTERS)("contract: %s parses", async (_name, query) => {
    const res = await call("alice", { path: "/api/albums/date/list/", query });
    expect(res.status).toBe(200);
    const { results } = expectSchema(FetchDateAlbumsListResponse, res.body);
    for (const g of results) {
      expect(g.items).toEqual([]);
      expect(g.incomplete).toBe(true);
      expect(g.numberOfItems).toBeGreaterThan(0);
    }
  });

  it.each(FILTERS)("twin: %s", async (_name, query) => {
    await expectTwin("alice", { path: "/api/albums/date/list/", query }, { project: GROUP });
  });

  it("twin: person, folder and every role", async () => {
    for (const person of Object.values(manifest().persons)) {
      await expectTwin(person.owner, { path: "/api/albums/date/list/", query: { person: person.id } }, { project: GROUP });
    }
    const folder = await scanDirectory("alice");
    await expectTwin("alice", { path: "/api/albums/date/list/", query: { folder } }, { project: GROUP });
    for (const role of ["admin", "bob", "carol", "dave"] as const) {
      await expectTwin(role, { path: "/api/albums/date/list/" }, { project: GROUP });
    }
  });

  it("twin: anonymous public timelines (all users, one user, nobody)", async () => {
    for (const query of [{ public: "true" }, { public: "true", username: "alice" }, { public: "true", username: "nobody" }]) {
      // Days of different owners can share a date; Django leaves their order open.
      await expectTwin("anonymous", { path: "/api/albums/date/list/", query }, { project: GROUP, unordered: ["results"] });
    }
  });
});

describe.skipIf(!hasBase)("timeline_photos: GET /api/albums/date/{id}", () => {
  it("contract: every one of alice's days parses and agrees with the list", async () => {
    const list = await call("alice", { path: "/api/albums/date/list/" });
    const { results } = expectSchema(FetchDateAlbumsListResponse, list.body);
    for (const g of results) {
      // The frontend omits the trailing slash (a 301 on Django).
      const res = await call("alice", { path: `/api/albums/date/${g.id}`, query: { page: 1 } });
      expect(res.status).toBe(200);
      const day = expectSchema(FetchDateAlbumResponse, res.body).results;
      expect(day.id).toBe(g.id);
      expect(day.numberOfItems).toBe(g.numberOfItems);
      expect(day.items.length).toBe(Math.min(100, g.numberOfItems));
    }
  });

  it("twin: every day of every user, as its owner", async () => {
    for (const d of manifest().albums.date) {
      await expectTwin(d.owner, { path: `/api/albums/date/${d.id}`, query: { page: 1 } }, { project: PAGE, refStable: false });
    }
  });

  it("twin: filters on each of alice's days", async () => {
    for (const d of aliceDays()) {
      for (const [, query] of FILTERS) {
        await expectTwin("alice", { path: `/api/albums/date/${d.id}/`, query: { ...query, page: 1 } }, { project: PAGE, refStable: false });
      }
    }
  });

  it("twin: paging (size, past the end, below 1, junk)", async () => {
    const biggest = [...aliceDays()].sort((a, b) => b.photo_count - a.photo_count)[0]!;
    for (const query of [
      { size: 1, page: 2 },
      { size: 2, page: 99 },
      { size: 1, page: 0 },
      { size: 1, page: -3 },
      { size: 1, page: "abc" },
      { size: 1 },
      { size: 3, page: 2 },
    ]) {
      await expectTwin("alice", { path: `/api/albums/date/${biggest.id}`, query }, { project: PAGE });
    }
  });

  it("twin: public days, anonymous and signed in", async () => {
    for (const d of manifest().albums.date) {
      for (const role of ["anonymous", "dave"] as Role[]) {
        await expectTwin(role, { path: `/api/albums/date/${d.id}`, query: { public: "true", page: 1 } }, { project: PAGE, refStable: false });
        await expectTwin(role, { path: `/api/albums/date/${d.id}`, query: { public: "true", username: d.owner, page: 1 } }, { project: PAGE, refStable: false });
      }
    }
  });
});

describe.skipIf(!hasBase)("timeline_photos: authz date albums", () => {
  const day = aliceDays()[0]!;
  const cases: AuthzCase[] = [
    { name: "list", req: { path: "/api/albums/date/list/" }, expect: { alice: 200, anonymous: 401 } },
    { name: "public list", req: { path: "/api/albums/date/list/", query: { public: "true" } }, expect: { anonymous: 200 } },
    { name: "alice's day", req: { path: `/api/albums/date/${day.id}/` }, expect: { alice: 200, bob: 404, anonymous: 401 } },
    { name: "alice's day, public view", req: { path: `/api/albums/date/${day.id}/`, query: { public: "true" } } },
    { name: "unknown day", req: { path: "/api/albums/date/999999/" }, expect: { alice: 404, anonymous: 401 } },
  ];
  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
