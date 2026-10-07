// librephotos-ts command line.
//   bun run src/cli.ts adopt   take over a database Django migrated (api.0142+)
//   bun run src/cli.ts scan [username...] [--full] [--followups]
//                              scan.user inline to completion (every user with
//                              a scan directory when none is named), SCAN_REPORT json
//   bun run src/cli.ts strip-thumbnail-metadata [--dry-run]
//
// adopt applies migrations/*.sql: the same additive objects librephotos-rs
// creates (site_settings, refresh_token, job_queue, ...), written
// idempotently, so Django, Rust and TS can take turns on one database. Then
// it imports constance values into site_settings (existing rows win).
import "./lib/tz";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { client } from "./lib/db";
import { constanceDecode, SETTING_KEYS } from "./lib/settings";

const MIGRATIONS = path.join(import.meta.dir, "..", "migrations");

export async function adopt(): Promise<void> {
  const [{ ok }] = await client`SELECT to_regclass('django_migrations') IS NOT NULL AS ok`;
  if (!ok) throw new Error("no django_migrations table: this is not a Django-migrated database");
  const [{ n }] = await client`SELECT count(*)::int AS n FROM django_migrations WHERE app = 'api' AND name LIKE '0142_%'`;
  if (n === 0) throw new Error("database is behind api.0142; run Django's migrate first");
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    await client.unsafe(readFileSync(path.join(MIGRATIONS, f), "utf8")).simple();
  }
  const [{ has }] = await client`SELECT to_regclass('constance_constance') IS NOT NULL AS has`;
  if (has) {
    const rows: { key: string; value: string | null }[] = await client`SELECT key, value FROM constance_constance`;
    for (const r of rows) {
      if (!SETTING_KEYS.includes(r.key as never) || r.value == null) continue;
      const v = constanceDecode(r.value);
      if (v === undefined) continue;
      await client`INSERT INTO site_settings (key, value) VALUES (${r.key}, ${JSON.stringify(v)}::text::jsonb) ON CONFLICT (key) DO NOTHING`;
    }
  }
}

if (import.meta.main) {
  const cmd = process.argv[2];
  try {
    if (cmd === "adopt") {
      await adopt();
      console.log("adopted");
    } else if (cmd === "scan" || cmd === "strip-thumbnail-metadata") {
      const { ingestCommand } = await import("./features/ingest/cli");
      await ingestCommand(cmd, process.argv.slice(3));
    } else {
      console.error("usage: cli.ts adopt | scan [username...] [--full] [--followups] | strip-thumbnail-metadata [--dry-run]");
      process.exit(2);
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
  await client.close();
}
