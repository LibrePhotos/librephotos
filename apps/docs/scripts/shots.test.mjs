// node --test "scripts/**/*.test.mjs" (from apps/docs): the lookups behind <Screenshot>.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { SHOTS_DIR } from "./lib/release-posts.mjs";
import { findShot, shotPath } from "../src/data/shots.ts";

const SHOTS = [{ id: "timeline", alt: "The timeline", width: 1600, height: 1000 }];

describe("findShot", () => {
  it("returns the manifest entry", () => {
    assert.deepEqual(findShot(SHOTS, "timeline"), SHOTS[0]);
  });

  it("throws for an unknown id, so the build fails", () => {
    assert.throws(() => findShot(SHOTS, "nope"), /<Screenshot id="nope" \/>: no such shot/);
  });

  it("finds every shot the landing page uses in the real manifest", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SHOTS_DIR, "manifest.json"), "utf8"));
    for (const id of ["timeline", "lightbox", "faces", "places", "events"]) {
      assert.ok(findShot(manifest, id).alt.length > 20, `${id} needs a real alt text`);
    }
  });
});

describe("shotPath", () => {
  it("names the light and the dark file", () => {
    assert.equal(shotPath("timeline", "light"), "/img/shots/timeline-light.webp");
    assert.equal(shotPath("timeline", "dark"), "/img/shots/timeline-dark.webp");
  });
});
