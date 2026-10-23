#!/usr/bin/env node
// Regenerates src/data/releases.json from the release posts in apps/docs/blog, and the web app's
// copy for its "What's new" card (apps/frontend/src/components/whatsnew/releases.json).
// Run from apps/docs after adding or editing a release post, and commit the result:
//
//   node scripts/build-releases.mjs

import fs from "node:fs";
import {
  RELEASES_JSON,
  WHATS_NEW_JSON,
  buildReleaseIndex,
  buildWhatsNew,
  readReleasePosts,
  serializeReleaseIndex,
} from "./lib/release-posts.mjs";

const index = buildReleaseIndex(readReleasePosts());
fs.writeFileSync(RELEASES_JSON, serializeReleaseIndex(index));
console.log(`Wrote ${RELEASES_JSON}: ${index.releases.length} release post(s), latest ${index.latest}`);
const whatsNew = buildWhatsNew(index);
fs.writeFileSync(WHATS_NEW_JSON, serializeReleaseIndex(whatsNew));
console.log(`Wrote ${WHATS_NEW_JSON}: ${whatsNew.releases.length} release(s)`);
