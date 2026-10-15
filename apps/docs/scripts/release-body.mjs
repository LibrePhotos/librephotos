#!/usr/bin/env node
// Prints the GitHub release body for a release, generated from its post in apps/docs/blog:
//
//   node scripts/release-body.mjs 1.4.0 > body.md
//   gh release create 1.4.0 --target <sha> --title "..." --notes-file body.md
//
// Check the rendering without creating anything:
//   gh api markdown -f mode=gfm -F text=@body.md > body.html

import { readReleasePosts, readShots, toGithubMarkdown } from "./lib/release-posts.mjs";

const tag = process.argv[2];
if (!tag) {
  console.error("usage: node scripts/release-body.mjs <tag>");
  process.exit(2);
}
const post = readReleasePosts().find((p) => p.data.release === tag || (p.data.covers ?? []).includes(tag));
if (!post) {
  console.error(`No release post for ${tag} in apps/docs/blog (front matter release: "${tag}")`);
  process.exit(1);
}
process.stdout.write(toGithubMarkdown(post, readShots()));
