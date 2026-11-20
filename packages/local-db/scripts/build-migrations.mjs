#!/usr/bin/env node
/**
 * Build migrations/migrations.json from the drizzle-kit journal and SQL files:
 * an ordered array of { tag, statements[] }. Every runtime applies that file and
 * nothing else: the TS runner (src/migrate.ts) imports it, the desktop's Rust
 * side include_str!s it. A statement is one chunk between drizzle-kit's
 * `--> statement-breakpoint` markers, so a trigger body with inner `;` stays whole;
 * full-line `--` comments are dropped, so each entry is exactly one statement.
 *
 *   node scripts/build-migrations.mjs           write the file
 *   node scripts/build-migrations.mjs --check   fail (exit 1) when it is stale (CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const out = join(dir, "migrations.json");

/** The migrations as the journal orders them. */
export function buildMigrations(migrationsDir = dir) {
  const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"));
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => ({
      tag: entry.tag,
      statements: readFileSync(join(migrationsDir, `${entry.tag}.sql`), "utf8")
        .replace(/\r\n/g, "\n")
        .split("--> statement-breakpoint")
        .map((chunk) =>
          chunk
            .split("\n")
            .filter((line) => !/^\s*--/.test(line))
            .join("\n")
            .trim()
        )
        .filter((chunk) => chunk.length > 0),
    }));
}

export function render(migrations) {
  return `${JSON.stringify(migrations, null, 2)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const expected = render(buildMigrations());
  if (process.argv.includes("--check")) {
    let actual = "";
    try {
      actual = readFileSync(out, "utf8");
    } catch {
      // missing counts as stale
    }
    if (actual !== expected) {
      console.error("migrations/migrations.json is out of date: run `node scripts/build-migrations.mjs`.");
      process.exit(1);
    }
    console.log("migrations.json matches the SQL migrations.");
  } else {
    writeFileSync(out, expected, "utf8");
    console.log(`wrote ${out}`);
  }
}
