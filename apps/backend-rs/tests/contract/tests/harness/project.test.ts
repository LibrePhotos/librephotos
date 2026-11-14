import { describe, expect, it } from "vitest";

import { buildSelector, diff, MISSING, normalize, project } from "../../src/project";

const body = {
  count: 2,
  next: "http://127.0.0.1:8931/api/jobs/?page=2",
  results: [
    { id: 1, date: "2024-05-12T10:00:00Z", extra: "x", items: [{ id: "a", aspectRatio: 1.33 }] },
    { id: 2, date: "2024-05-12T12:00:00+02:00", extra: "y", items: [] },
  ],
};

describe("projection", () => {
  it("keeps only the selected paths and marks absent ones", () => {
    const sel = buildSelector(["count", "results[].id", "results[].items[].aspectRatio", "results[].nope"]);
    expect(project(body, sel)).toEqual({
      count: 2,
      results: [
        { id: 1, nope: MISSING, items: [{ aspectRatio: 1.33 }] },
        { id: 2, nope: MISSING, items: [] },
      ],
    });
  });

  it("compares datetimes as instants and strips server origins", () => {
    const a = normalize({ t: "2024-05-12T12:00:00+02:00", next: body.next }, { origins: ["http://127.0.0.1:8931"] });
    const b = normalize({ t: "2024-05-12T10:00:00Z", next: "http://127.0.0.1:9000/api/jobs/?page=2" }, { origins: ["http://127.0.0.1:9000"] });
    expect(diff(a, b)).toEqual([]);
  });

  it("compares numbers numerically and arrays unordered on request", () => {
    expect(diff({ n: 0.1 + 0.2 }, { n: 0.3 })).toEqual([]);
    const opts = { unordered: ["results"] };
    expect(diff(normalize({ results: [3, 1, 2] }, opts), normalize({ results: [1, 2, 3] }, opts))).toEqual([]);
    expect(diff({ results: [3, 1, 2] }, { results: [1, 2, 3] })).not.toEqual([]);
  });

  it("reports length and value differences with paths", () => {
    const d = diff({ results: [{ id: 1 }, { id: 2 }] }, { results: [{ id: 1 }] });
    expect(d.map(x => x.path)).toEqual(["results.length"]);
    expect(diff({ a: { b: "x" } }, { a: { b: "y" } })[0]?.path).toBe("a.b");
  });
});
