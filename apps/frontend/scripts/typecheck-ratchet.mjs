#!/usr/bin/env node
/**
 * Type-check ratchet.
 *
 * `vite build` does not type-check, so the codebase carries a backlog of
 * TypeScript errors. This script runs `tsc --noEmit` and compares the result
 * against a checked-in baseline (tsc-baseline.txt):
 *
 *   - any error that is not in the baseline fails the check (exit 1);
 *   - baseline entries that no longer occur only print a hint, so fixing
 *     errors elsewhere (or merging a PR that does) never breaks the build.
 *
 * Errors are keyed as `file: TSxxxx message` without line/column, so edits
 * that merely move an existing error around do not count as new. Keys are
 * compared as a multiset: a second identical error in the same file is new.
 *
 * Usage:
 *   node scripts/typecheck-ratchet.mjs            check against the baseline
 *   node scripts/typecheck-ratchet.mjs --update   rewrite the baseline
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "tsc-baseline.txt");
const HEADER = [
  "# TypeScript error baseline for `yarn typecheck` (scripts/typecheck-ratchet.mjs).",
  "# Known errors, one per line as `file: TSxxxx message`, sorted. CI fails on any error not listed here.",
  "# Fixed some? Shrink this file with `yarn typecheck:update`. Do not add entries by hand.",
];

const update = process.argv.includes("--update");

// Plain code-unit comparison: identical order on every platform and locale.
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function normaliseFile(file) {
  const abs = path.resolve(ROOT, file.trim());
  return path.relative(ROOT, abs).split(path.sep).join("/").replace(/\\/g, "/");
}

function runTsc() {
  const tsc = createRequire(path.join(ROOT, "package.json")).resolve("typescript/bin/tsc");
  const result = spawnSync(process.execPath, [tsc, "--noEmit", "-p", "tsconfig.json", "--pretty", "false"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** Parse `tsc --pretty false` output into [{ key, raw }]. Continuation lines are ignored. */
function parseErrors(output) {
  const errors = [];
  for (const line of output.split(/\r?\n/)) {
    let match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
    if (match) {
      const [, file, , , code, message] = match;
      errors.push({ key: `${normaliseFile(file)}: ${code} ${message.trim()}`, raw: line.trim() });
      continue;
    }
    match = /^error (TS\d+): (.*)$/.exec(line);
    if (match) errors.push({ key: `<global>: ${match[1]} ${match[2].trim()}`, raw: line.trim() });
  }
  return errors;
}

function readBaseline() {
  if (!existsSync(BASELINE)) return [];
  return readFileSync(BASELINE, "utf8")
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line && !line.startsWith("#"));
}

function countKeys(keys) {
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

/** Keys whose count in `from` exceeds their count in `to`, repeated by the excess, sorted. */
function excess(from, to) {
  const out = [];
  for (const [key, n] of from) for (let i = to.get(key) ?? 0; i < n; i++) out.push(key);
  return out.sort(byCodeUnit);
}

const { status, output } = runTsc();
const errors = parseErrors(output);

if (status !== 0 && errors.length === 0) {
  // tsc failed without reporting type errors (bad config, crash, ...): never pass silently.
  process.stderr.write(output);
  console.error(`\ntypecheck: tsc exited with status ${status} but reported no parsable errors.`);
  process.exit(2);
}

const current = errors.map(e => e.key).sort(byCodeUnit);
const baseline = readBaseline();

if (update) {
  writeFileSync(BASELINE, `${[...HEADER, ...current].join("\n")}\n`);
  console.log(
    `typecheck: wrote ${current.length} error(s) to ${path.relative(ROOT, BASELINE)} (was ${baseline.length}).`
  );
  process.exit(0);
}

const currentCounts = countKeys(current);
const baselineCounts = countKeys(baseline);
const added = excess(currentCounts, baselineCounts);
const fixed = excess(baselineCounts, currentCounts);

console.log(`typecheck: ${current.length} error(s), ${baseline.length} in baseline.`);

if (fixed.length > 0) {
  console.log(`\n${fixed.length} baseline error(s) no longer occur. Nice! Shrink the baseline with:`);
  console.log("  yarn typecheck:update");
}

if (added.length > 0) {
  const addedSet = new Set(added);
  console.error(`\n${added.length} new TypeScript error(s) not in the baseline:\n`);
  // Print the raw tsc lines (with line/column) for every occurrence of a new key, so they can be found.
  // When a key was already in the baseline N times, all N+1 occurrences are listed: one of them is new.
  for (const e of errors.filter(e => addedSet.has(e.key)).sort((a, b) => byCodeUnit(a.raw, b.raw))) {
    console.error(`  ${e.raw}`);
  }
  console.error(
    "\nFix them; the baseline only exists for errors that predate the check. " +
      "Run `yarn typecheck` locally to reproduce."
  );
  process.exit(1);
}

console.log("typecheck: no new errors.");
