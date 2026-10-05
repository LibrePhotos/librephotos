// Search: GET /api/photos/searchlist/?search= (useSearchPhotosQuery) and
// GET /api/searchtermexamples/ (useSearchExamplesQuery).
import { SearchExamplesResponse, SearchPhotos } from "@fe/search/types";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase, REF_URL } from "../../src/env";
import { category, manifest, photo, type Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

// PigPhoto fields the grid reads (03 §4). Stack `photo_count` is left out:
// Django always reports 1 there (see apps/backend-rs/CLAUDE.md).
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
const GROUPED = ["results[].date", "results[].location", ...PIG.map(f => `results[].items[].${f}`)];
// Django orders by -exif_timestamp only; photos sharing a timestamp come in
// planner order.
const GROUPED_SPEC = { project: GROUPED, unordered: ["results[].items"] };

const SEARCHES: [string, Record<string, string>][] = [
  ["a place name", { search: "berlin" }],
  ["two terms (AND)", { search: "Berlin 2022" }],
  ["a quoted phrase", { search: '"Pariser Platz"' }],
  ["OCR text (full-text match)", { search: "invoice" }],
  ["an OCR word inside the text", { search: "Total" }],
  ["comma-separated terms", { search: "19,99" }],
  ["a tag name", { search: "trips" }],
  ["two tags (the tags join is shared across terms)", { search: "family trips" }],
  ["a unicode tag", { search: "Straße" }],
  ["the timestamp text", { search: "2023-08" }],
  ["a person name in captions", { search: "anna" }],
  ["a file name in captions", { search: "e2e_01" }],
  ["LIKE metacharacters are literal", { search: "100%" }],
  ["an underscore is literal", { search: "_0" }],
  ["no match", { search: "zzz-no-such-thing" }],
  ["empty search = everything", { search: "" }],
  ["videos only", { search: "", video: "true" }],
  ["photos only with a term", { search: "e2e", photo: "true" }],
  ["screenshots", { search: "", is_screenshot: "true" }],
  ["documents", { search: "", is_document: "true" }],
  ["video wins over photo", { search: "", video: "true", photo: "true" }],
  ["a lone quote is an empty term", { search: '"' }],
];

describe.skipIf(!hasBase)("GET /api/photos/searchlist/", () => {
  it("contract: grouped results parse with the frontend schema", async () => {
    const res = await call("alice", { path: "/api/photos/searchlist/", query: { search: "berlin" } });
    expect(res.status).toBe(200);
    const { results } = expectSchema(SearchPhotos, res.body);
    const hashes = results.flatMap(g => g.items.map(i => i.image_hash));
    expect(hashes).toContain(photo("alice/berlin_01").image_hash);
  });

  it("contract: an empty search parses and lists every visible photo once", async () => {
    const res = await call("alice", { path: "/api/photos/searchlist/", query: { search: "" } });
    const { results } = expectSchema(SearchPhotos, res.body);
    const ids = results.flatMap(g => g.items.map(i => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const hidden of category("hidden")) expect(ids).not.toContain(hidden.id);
  });

  it("contract: OCR matches do not leak another user's photos", async () => {
    const res = await call("bob", { path: "/api/photos/searchlist/", query: { search: "invoice" } });
    const { results } = expectSchema(SearchPhotos, res.body);
    expect(results).toEqual([]);
  });

  it.each(SEARCHES)("twin (alice): %s", async (_name, query) => {
    await expectTwin("alice", { path: "/api/photos/searchlist/", query }, GROUPED_SPEC);
  });

  it.each(["bob", "carol", "dave", "admin"] as Role[])("twin (%s): only their own photos", async role => {
    await expectTwin(role, { path: "/api/photos/searchlist/", query: { search: "" } }, GROUPED_SPEC);
    await expectTwin(role, { path: "/api/photos/searchlist/", query: { search: "own" } }, GROUPED_SPEC);
  });

  it("twin: no search parameter at all", async () => {
    await expectTwin("alice", { path: "/api/photos/searchlist/" }, GROUPED_SPEC);
  });

  it("twin: a NUL character is a 400", async () => {
    await expectTwin("alice", { path: "/api/photos/searchlist/", query: { search: "a\u0000b" } }, {
      project: ["errors[].field", "errors[].message"],
    });
  });
});

describe.skipIf(!hasBase)("authz: search", () => {
  const cases: AuthzCase[] = [
    { name: "searchlist", req: { path: "/api/photos/searchlist/?search=a" }, expect: { alice: 200, anonymous: 401 } },
    { name: "searchtermexamples", req: { path: "/api/searchtermexamples/" }, expect: { alice: 200, anonymous: 401 } },
  ];
  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });

  it("twin: a bad Authorization header is a 401", async () => {
    const { actual } = await expectTwin(
      "anonymous",
      { path: "/api/photos/searchlist/", query: { search: "a" }, headers: { Authorization: "Bearer not-a-token" } },
      // Status only: the 401 envelope itself belongs to the auth layer.
      { project: ["__status_only__"] },
    );
    expect(actual.status).toBe(401);
  });
});

describe.skipIf(!hasBase)("GET /api/searchtermexamples/", () => {
  it("contract: alice's examples parse and are unique, trimmed, non-empty strings", async () => {
    const res = await call("alice", { path: "/api/searchtermexamples/" });
    expect(res.status).toBe(200);
    const results = expectSchema(SearchExamplesResponse, res.body).results;
    expect(results.length).toBeGreaterThan(0);
    expect(new Set(results).size).toBe(results.length);
    for (const t of results) expect(t).toBe(t.trim());
    expect(results).not.toContain("for people");
  });

  it("contract: the answer is cached per user (same list on the next call)", async () => {
    const a = await call<{ results: string[] }>("alice", { path: "/api/searchtermexamples/" });
    const b = await call<{ results: string[] }>("alice", { path: "/api/searchtermexamples/" });
    expect(b.body.results).toEqual(a.body.results);
  });

  it("twin (dave, no captioned photos): the five default prompts", async () => {
    await expectTwin("dave", { path: "/api/searchtermexamples/" }, { project: ["results"], unordered: ["results"] });
  });

  it("twin (alice): the examples are random, only the shape is compared", async () => {
    const ref = await call<{ results: string[] }>("alice", { path: "/api/searchtermexamples/" }, REF_URL);
    const actual = await call<{ results: string[] }>("alice", { path: "/api/searchtermexamples/" });
    expect(actual.status).toBe(ref.status);
    expectSchema(SearchExamplesResponse, ref.body);
    // Both draw their years from alice's (captioned) photos.
    const aliceYears = new Set(
      Object.values(manifest().photos)
        .filter(p => p.owner === "alice" && p.exif_timestamp)
        .map(p => p.exif_timestamp!.slice(0, 4)),
    );
    const years = (xs: string[]) => xs.filter(x => /^\d{4}$/.test(x));
    for (const y of years(actual.body.results)) expect([...aliceYears]).toContain(y);
    expect(years(actual.body.results).length).toBeGreaterThan(0);
    expect(years(ref.body.results).length).toBeGreaterThan(0);
  });
});
