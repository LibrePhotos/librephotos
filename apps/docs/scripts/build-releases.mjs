#!/usr/bin/env node
// Regenerates src/data/releases.json from the release posts in apps/docs/blog.
// Run from apps/docs after adding or editing a release post, and commit the result:
//
//   node scripts/build-releases.mjs

import fs from "node:fs";
import { RELEASES_JSON, buildReleaseIndex, readReleasePosts, serializeReleaseIndex } from "./lib/release-posts.mjs";

const index = buildReleaseIndex(readReleasePosts());
fs.writeFileSync(RELEASES_JSON, serializeReleaseIndex(index));
console.log(`Wrote ${RELEASES_JSON}: ${index.releases.length} release post(s), latest ${index.latest}`);
