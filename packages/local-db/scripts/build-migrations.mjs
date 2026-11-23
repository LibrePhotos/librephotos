#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const out = join(dir, "migrations.json");

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
    const actual = existsSync(out) ? readFileSync(out, "utf8") : "";
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
