// node --test "scripts/**/*.test.mjs" (from apps/docs): the filters behind <FeatureComparison>
// and the shape of src/data/feature-comparison.json.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  defaultFilters,
  differs,
  filtersFromQuery,
  filtersToQuery,
  isAvailable,
  mustHaveScore,
  productsMeeting,
  visibleFeatures,
  visibleProducts,
} from "../src/data/featureComparison.ts";

const product = (id, kind = "server") => ({ id, name: id, url: `https://${id}.test`, kind, openSource: true, checked: "1.0" });

const COMPARISON = {
  checked: "2026-11-13",
  categories: [
    { id: "ai", label: "AI" },
    { id: "sharing", label: "Sharing" },
  ],
  products: [product("a"), product("b"), product("c", "saas")],
  features: [
    { id: "faces", name: "Face recognition", category: "ai", cells: { a: { s: "yes" }, b: { s: "yes" }, c: { s: "yes" } } },
    { id: "clip", name: "Semantic search", category: "ai", cells: { a: { s: "yes" }, b: { s: "no" }, c: { s: "plugin", n: "needs photofield-ai" } } },
    { id: "links", name: "Share links", category: "sharing", cells: { a: { s: "yes" }, b: { s: "partial" }, c: { s: "no" } } },
    { id: "license", name: "License", category: "sharing", cells: { a: { v: "MIT" }, b: { v: "AGPL-3.0" } } },
  ],
};

const filters = (patch = {}) => ({ ...defaultFilters(COMPARISON), ...patch });
const ids = (list) => list.map((x) => x.id);

describe("isAvailable", () => {
  it("counts every status you can get today", () => {
    for (const s of ["yes", "partial", "plugin", "paid"]) assert.equal(isAvailable({ s }), true, s);
    for (const s of ["planned", "no", "na", "unknown"]) assert.equal(isAvailable({ s }), false, s);
    assert.equal(isAvailable(undefined), false);
    assert.equal(isAvailable({ v: "MIT" }), true);
  });
});

describe("visibleFeatures", () => {
  it("shows everything by default", () => {
    assert.deepEqual(ids(visibleFeatures(COMPARISON, filters())), ["faces", "clip", "links", "license"]);
  });

  it("filters by category", () => {
    assert.deepEqual(ids(visibleFeatures(COMPARISON, filters({ categories: ["sharing"] }))), ["links", "license"]);
  });

  it("matches every word of the text against names and the shown notes", () => {
    assert.deepEqual(ids(visibleFeatures(COMPARISON, filters({ text: "photofield" }))), ["clip"]);
    assert.deepEqual(ids(visibleFeatures(COMPARISON, filters({ text: "photofield", products: ["a", "b"] }))), []);
    assert.deepEqual(ids(visibleFeatures(COMPARISON, filters({ text: "share LINKS" }))), ["links"]);
  });

  it("keeps only rows where the shown apps differ", () => {
    assert.deepEqual(ids(visibleFeatures(COMPARISON, filters({ onlyDifferences: true }))), ["clip", "links", "license"]);
    assert.deepEqual(ids(visibleFeatures(COMPARISON, filters({ onlyDifferences: true, products: ["a"] }))), []);
  });

  it("never hides a must-have row", () => {
    const shown = visibleFeatures(COMPARISON, filters({ categories: ["sharing"], mustHave: ["faces"] }));
    assert.deepEqual(ids(shown), ["faces", "links", "license"]);
  });
});

describe("must-haves", () => {
  it("scores and filters products", () => {
    assert.equal(mustHaveScore(COMPARISON, ["clip", "links"], "a"), 2);
    assert.equal(mustHaveScore(COMPARISON, ["clip", "links"], "b"), 1);
    assert.deepEqual(productsMeeting(COMPARISON, ["clip", "links"]), ["a"]);
    assert.deepEqual(productsMeeting(COMPARISON, []), ["a", "b", "c"]);
  });

  it("hides products missing one only when asked", () => {
    assert.deepEqual(ids(visibleProducts(COMPARISON, filters({ mustHave: ["clip"] }))), ["a", "b", "c"]);
    assert.deepEqual(ids(visibleProducts(COMPARISON, filters({ mustHave: ["clip"], hideMissingMustHave: true }))), ["a", "c"]);
  });
});

describe("differs", () => {
  it("compares status and value", () => {
    assert.equal(differs(COMPARISON.features[0], ["a", "b", "c"]), false);
    assert.equal(differs(COMPARISON.features[3], ["a", "b"]), true);
  });
});

describe("query string", () => {
  it("is empty at the defaults", () => {
    assert.equal(filtersToQuery(COMPARISON, filters()), "");
  });

  it("round-trips", () => {
    const f = filters({ text: "faces", categories: ["ai"], products: ["a", "c"], onlyDifferences: true, mustHave: ["clip"], hideMissingMustHave: true });
    assert.deepEqual(filtersFromQuery(COMPARISON, filtersToQuery(COMPARISON, f)), f);
  });

  it("drops unknown ids", () => {
    const f = filtersFromQuery(COMPARISON, "?apps=a,zzz&need=nope,faces&cat=ai,x");
    assert.deepEqual(f.products, ["a"]);
    assert.deepEqual(f.mustHave, ["faces"]);
    assert.deepEqual(f.categories, ["ai"]);
  });
});

describe("feature-comparison.json", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const data = JSON.parse(fs.readFileSync(path.join(dir, "../src/data/feature-comparison.json"), "utf8"));
  const STATUSES = new Set(["yes", "partial", "plugin", "paid", "planned", "no", "na", "unknown"]);

  it("has unique ids and known categories, products and statuses", () => {
    const categories = new Set(data.categories.map((c) => c.id));
    const products = new Set(data.products.map((p) => p.id));
    assert.equal(products.size, data.products.length, "duplicate product id");
    const seen = new Set();
    for (const f of data.features) {
      assert.ok(!seen.has(f.id), `duplicate feature id ${f.id}`);
      seen.add(f.id);
      assert.ok(categories.has(f.category), `${f.id}: unknown category ${f.category}`);
      for (const [id, cell] of Object.entries(f.cells)) {
        assert.ok(products.has(id), `${f.id}: unknown product ${id}`);
        assert.ok(cell.s === undefined || STATUSES.has(cell.s), `${f.id}.${id}: unknown status ${cell.s}`);
        assert.ok(cell.s !== undefined || cell.v, `${f.id}.${id}: needs a status or a value`);
      }
    }
  });

  it("answers every feature for every product", () => {
    for (const f of data.features) {
      for (const p of data.products) assert.ok(f.cells[p.id], `${f.id} has no cell for ${p.id}`);
    }
  });
});
