import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { isPlanned, isWeekly, planRoadmap, ROADMAP } from "../src/data/roadmap.ts";
import { sinceState } from "../src/data/releases.ts";

const INDEX = JSON.parse(fs.readFileSync(new URL("../src/data/releases.json", import.meta.url), "utf8"));
const REPO = "https://github.com/LibrePhotos/librephotos/";

function lookup(version) {
  if (!sinceState(version, INDEX).released) {
    return null;
  }
  const entry = INDEX.releases.find((r) => r.versions.includes(version));
  return { date: entry.date, permalink: entry.permalink };
}

const item = (fields) => ({ track: "feature", title: "T", body: "B", link: "/docs/intro", ...fields });

describe("planRoadmap", () => {
  it("puts a released version under its release and an unreleased one under next", () => {
    const plan = planRoadmap(
      [item({ id: "a", version: "9.0.0" }), item({ id: "b", version: "1.0.0" })],
      (v) => (v === "1.0.0" ? { date: "2026-06-26T10:53:57Z", permalink: "/blog/1-0-0" } : null),
    );
    assert.deepEqual(
      plan.next.map((i) => i.id),
      ["a"],
    );
    assert.equal(plan.shipped[0].version, "1.0.0");
    assert.equal(plan.shipped[0].date, "2026-06-26");
  });

  it("orders releases newest first and planned work by status", () => {
    const plan = planRoadmap(
      [
        item({ id: "old", weekly: "2023w18", date: "2023-05-01" }),
        item({ id: "new", weekly: "2026w25", date: "2026-06-21" }),
        item({ id: "p", status: "planned", issue: 1 }),
        item({ id: "w", status: "in-progress", pr: 2 }),
      ],
      () => null,
    );
    assert.deepEqual(
      plan.shipped.map((r) => r.version),
      ["2026w25", "2023w18"],
    );
    assert.equal(plan.shipped[1].permalink, "/blog/2023w18");
    assert.deepEqual(
      plan.planned.map((i) => i.id),
      ["w", "p"],
    );
  });

  it("throws on a duplicate id", () => {
    assert.throws(() => planRoadmap([item({ id: "x", version: "1.0.0" }), item({ id: "x", version: "1.0.0" })], lookup), /listed twice/);
  });
});

describe("ROADMAP", () => {
  it("plans without errors against the real release index", () => {
    const plan = planRoadmap(ROADMAP, lookup);
    assert.ok(plan.shipped.length > 5);
  });

  it("names the issue or pull request of every entry that is not merged", () => {
    for (const entry of ROADMAP.filter(isPlanned)) {
      const onGitHub = entry.link.startsWith(REPO);
      if (onGitHub) {
        const number = entry.issue ?? entry.pr;
        assert.ok(number, `${entry.id} links to GitHub but names no issue or pr`);
        assert.ok(entry.link.endsWith(`/${number}`), `${entry.id} links to another number than ${number}`);
      } else {
        assert.ok(entry.link.startsWith("/docs/"), `${entry.id} needs an issue, a pr or a docs link`);
      }
    }
  });

  it("links to the docs, the blog or the LibrePhotos repository", () => {
    for (const entry of ROADMAP) {
      assert.match(entry.link, /^(\/docs\/|\/blog\/|https:\/\/github\.com\/LibrePhotos\/librephotos\/)/, entry.id);
    }
  });

  it("dates weekly releases like their post", () => {
    const posts = fs.readdirSync(new URL("../blog/", import.meta.url));
    for (const entry of ROADMAP.filter(isWeekly)) {
      assert.ok(posts.includes(`${entry.date}-${entry.weekly}.md`), `${entry.id}: no post ${entry.date}-${entry.weekly}.md`);
    }
  });

  it("keeps each line short and free of em dashes", () => {
    for (const entry of ROADMAP) {
      assert.ok(entry.body.length <= 130, `${entry.id}: body is ${entry.body.length} characters`);
      assert.ok(!/—/.test(entry.title + entry.body), `${entry.id} has an em dash`);
    }
  });
});
