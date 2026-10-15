#!/usr/bin/env node
// Checks the release posts in apps/docs/blog (see lib/release-posts.mjs) and that
// src/data/releases.json was regenerated from them. Run from apps/docs:
//
//   node scripts/check-release-posts.mjs                 # before the build
//   node scripts/check-release-posts.mjs --build build   # after it: links, anchors and <Since> badges
//
// Exits 1 and lists every problem when something is wrong.

import path from "node:path";
import { buildErrors, readReleasePosts, sourceErrors } from "./lib/release-posts.mjs";

function main(argv) {
  const flag = argv.indexOf("--build");
  const buildDir = flag === -1 ? undefined : path.resolve(argv[flag + 1] ?? "build");
  const posts = readReleasePosts();
  const errors = sourceErrors(posts);
  if (buildDir && errors.length === 0) {
    const build = buildErrors(buildDir, posts);
    console.log(`<Since> badges in the build: ${build.released} released, ${build.unreleased} not released yet`);
    errors.push(...build.errors);
  }
  if (errors.length > 0) {
    console.error(`Release posts: ${errors.length} problem(s)\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    return 1;
  }
  console.log(`Release posts: ${posts.length} post(s) OK`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
