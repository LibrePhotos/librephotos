// GET /photos/recentlyadded/, /photos/notimestamp/, /memories (03 §5).
import { FetchMemoriesResponse } from "@fe/memories/types";
import { PhotosWithoutTimestampResponse, RecentlyAddedPhotosResponse } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { manifest } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

// Stack photo_count left out: Django always says 1 (see date-albums.test.ts).
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
];
const USERS = ["admin", "alice", "bob", "carol", "dave"] as const;

describe.skipIf(!hasBase)("timeline_photos: GET /api/photos/recentlyadded/", () => {
  it("contract: parses for every user", async () => {
    for (const role of USERS) {
      const res = await call(role, { path: "/api/photos/recentlyadded/" });
      expect(res.status).toBe(200);
      const body = expectSchema(RecentlyAddedPhotosResponse, res.body);
      expect(body.results.length).toBeGreaterThan(0);
    }
  });

  it("twin: every user", async () => {
    for (const role of USERS) {
      await expectTwin(role, { path: "/api/photos/recentlyadded/" }, { project: ["date", ...PIG.map(f => `results[].${f}`)] });
    }
  });
});

describe.skipIf(!hasBase)("timeline_photos: GET /api/photos/notimestamp/", () => {
  it("contract: parses, counts the undated photos", async () => {
    const res = await call("alice", { path: "/api/photos/notimestamp/", query: { page: 1 } });
    expect(res.status).toBe(200);
    const body = expectSchema(PhotosWithoutTimestampResponse, res.body);
    expect(body.count).toBe(body.results.length);
    for (const p of body.results) expect(p.date ?? "").toBe("");
  });

  it("twin: pages and page sizes", async () => {
    const project = ["count", "next", "previous", ...PIG.map(f => `results[].${f}`)];
    for (const role of USERS) {
      await expectTwin(role, { path: "/api/photos/notimestamp/" }, { project });
    }
    for (const query of [{ page: 1 }, { page: 2 }, { page: "last" }, { page: 0 }, { page: "x" }, { page_size: 1 }, { page_size: 1, page: 2 }]) {
      await expectTwin("alice", { path: "/api/photos/notimestamp/", query }, { project });
    }
  });
});

describe.skipIf(!hasBase)("timeline_photos: GET /api/memories", () => {
  // Dates chosen so that the fixture's days (2020-01..2024-08) fall into day
  // windows, month fallbacks, and nothing at all.
  const QUERIES: Record<string, string | number>[] = [
    {},
    { size: 30 },
    { size: 200 },
    { date: "2025-08-04" },
    { date: "2025-08-04", size: 2 },
    { date: "2025-08-20", window: 0 },
    { date: "2025-08-18", window: 2 },
    { date: "2025-11-20" },
    { date: "2025-11-20", fallback: "false" },
    { date: "2026-01-02", window: 30 },
    { date: "2026-05-13" },
    { date: "2028-02-29" },
    { date: "bogus", window: "x", size: "y" },
    // Python's date.fromisoformat: basic and ISO-week forms parse, sloppy ones fall back to today.
    { date: "20250804" },
    { date: "2025-W32-1" },
    { date: "2025W32" },
    { date: "2025-8-4" },
    { date: " 2025-08-04" },
  ];

  it("contract: parses", async () => {
    for (const query of QUERIES) {
      const res = await call("alice", { path: "/api/memories", query });
      expect(res.status).toBe(200);
      expectSchema(FetchMemoriesResponse, res.body);
    }
    const some = await call("alice", { path: "/api/memories", query: { date: "2025-08-04" } });
    const parsed = expectSchema(FetchMemoriesResponse, some.body);
    expect(parsed.results.length).toBeGreaterThan(0);
  });

  it("twin: windows, fallbacks, sizes", async () => {
    const memory = ["id", "type", "years_ago", "year", "date", "start_date", "end_date", "location", "numberOfItems"];
    const project = [
      "date",
      "window_days",
      ...memory.map(f => `results[].${f}`),
      ...PIG.map(f => `results[].cover.${f}`),
      ...PIG.map(f => `results[].items[].${f}`),
    ];
    for (const query of QUERIES) {
      await expectTwin("alice", { path: "/api/memories", query }, { project });
    }
    for (const role of ["admin", "bob", "carol", "dave"] as const) {
      await expectTwin(role, { path: "/api/memories", query: { date: "2025-06-01", window: 30 } }, { project });
    }
  });
});

describe.skipIf(!hasBase)("timeline_photos: authz photo sets", () => {
  const cases: AuthzCase[] = [
    { name: "recently added", req: { path: "/api/photos/recentlyadded/" }, expect: { alice: 200, anonymous: 401 } },
    { name: "no timestamp", req: { path: "/api/photos/notimestamp/" }, expect: { alice: 200, anonymous: 401 } },
    { name: "memories", req: { path: "/api/memories" }, expect: { alice: 200, anonymous: 401 } },
  ];
  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });

  it("manifest sanity: alice has undated photos", () => {
    expect(manifest().categories.no_timestamp!.length).toBeGreaterThan(0);
  });
});
