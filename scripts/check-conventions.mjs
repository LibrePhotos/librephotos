#!/usr/bin/env node
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { commentViolations } from "./conventions/comments.mjs";
import { collectChanges } from "./conventions/diff.mjs";
import { docsViolation } from "./conventions/docs-rule.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `Usage: node scripts/check-conventions.mjs [--base <rev>] [--head <rev>] [--only comments|docs] [--json]

Checks the change between the merge base of <rev> (default origin/dev) and the
working tree (or --head) against the AGENTS.md rules: no comments on added lines,
and a docs change with every app or package source change.`;

const COMMENTS_HINT =
  "AGENTS.md: new or changed code carries no comments. Say it with names, types and tests; put the why in the commit message, the PR or the docs.";

const DOCS_HINT = [
  "AGENTS.md: every change to an app or package is reflected in apps/docs/docs or apps/docs/blog in the same PR.",
  "What users see goes in apps/docs/docs/user-guide/, deploy, settings and env vars in apps/docs/docs/installation/,",
  "internal changes in apps/docs/docs/development/. Tests, workflows, lockfiles, translations and",
  "version-only dependency bumps are exempt.",
].join("\n");

function annotate(path, line, message) {
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::error file=${path},line=${line}::${message}`);
}

function reportComments({ violations, errors }) {
  for (const error of errors) console.log(`${error.path}: could not read: ${error.message}`);
  if (violations.length === 0 && errors.length === 0) {
    console.log("comments: no comments on added lines");
    return true;
  }
  if (violations.length > 0) {
    console.log(`comments: ${violations.length} added line(s) carry a comment:`);
    for (const violation of violations) {
      console.log(`  ${violation.path}:${violation.line}  [${violation.kind}]  ${violation.text.slice(0, 120)}`);
    }
    for (const violation of violations.slice(0, 50)) annotate(violation.path, violation.line, `${violation.kind} on an added line`);
    console.log(COMMENTS_HINT);
  }
  return false;
}

function reportDocs(violation) {
  if (!violation) {
    console.log("docs: every source change comes with a docs change, or none is needed");
    return true;
  }
  console.log(`docs: ${violation.sources.length} source file(s) changed without a change under apps/docs/docs or apps/docs/blog:`);
  for (const path of violation.sources.slice(0, 40)) console.log(`  ${path}`);
  if (violation.sources.length > 40) console.log(`  ... and ${violation.sources.length - 40} more`);
  console.log(DOCS_HINT);
  return false;
}

function main() {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "origin/dev" },
      head: { type: "string" },
      only: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.only && !["comments", "docs"].includes(values.only)) {
    console.error(USAGE);
    return 2;
  }
  const files = collectChanges({ cwd: repoRoot, base: values.base, head: values.head });
  const comments = values.only === "docs" ? null : commentViolations(files.filter((file) => file.status !== "deleted"));
  const docs = values.only === "comments" ? undefined : docsViolation(files);
  if (values.json) {
    console.log(JSON.stringify({ comments, docs: docs ?? null }, null, 2));
    return (comments && (comments.violations.length || comments.errors.length)) || docs ? 1 : 0;
  }
  const commentsOk = comments ? reportComments(comments) : true;
  const docsOk = docs === undefined ? true : reportDocs(docs);
  return commentsOk && docsOk ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
