// librephotos-ts command line.
//   bun run src/cli.ts adopt   take over a database Django migrated (api.0142+)
//   bun run src/cli.ts scan [username...] [--full] [--followups]
//                              scan.user inline to completion (every user with
//                              a scan directory when none is named), SCAN_REPORT json
//   bun run src/cli.ts strip-thumbnail-metadata [--dry-run]
//   bun run src/cli.ts run-job <kind> '<json payload>' [--then <kind>]... [--setting K=V]...
//       run one job handler inline (no worker; the tasks differential runs
//       use it), then every job of the --then kinds the run queued
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

/** Run one handler inline (a fresh LongRunningJob unless the payload's job queues one), then drain `then` kinds. */
export async function runJob(kind: string, payload: unknown, then: string[], settings: [string, string][]): Promise<void> {
  const { handlerFor } = await import("./lib/jobs");
  await import("./jobs");
  for (const [k, v] of settings) {
    await client`INSERT INTO site_settings (key, value) VALUES (${k}, ${JSON.stringify(v)}::text::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  }
  const run = async (job: { id: number; kind: string; payload: any; lrj_id: string | null; group_id: string | null }) => {
    const handler = handlerFor(job.kind);
    if (!handler) throw new Error(`no handler for job kind ${JSON.stringify(job.kind)}`);
    const { Progress, lrjIsCancelled } = await import("./lib/jobs");
    const progress = new Progress(job.lrj_id);
    await handler({
      job: { ...job, status: "running", attempts: 1, max_attempts: 1 },
      payload: job.payload,
      lrjId: job.lrj_id,
      progress,
      isCancelled: async () => (job.lrj_id ? lrjIsCancelled(job.lrj_id) : false),
    });
    await progress.flush();
  };
  await run({ id: 0, kind, payload, lrj_id: null, group_id: null });
  for (const k of then) {
    for (;;) {
      const [job] = await client`UPDATE job_queue SET status = 'running', started_at = now(), attempts = attempts + 1
        WHERE id = (SELECT id FROM job_queue WHERE status = 'queued' AND kind = ${k} ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, kind, payload, lrj_id, group_id`;
      if (!job) break;
      let error: string | null = null;
      try {
        await run({ ...job, id: Number(job.id) });
      } catch (e) {
        error = (e as Error).message;
      }
      await client`UPDATE job_queue SET status = ${error === null ? "done" : "failed"}, finished_at = now(), last_error = ${error} WHERE id = ${job.id}`;
      if (error !== null) throw new Error(`${k}: ${error}`);
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
    } else if (cmd === "run-job" && process.argv[3]) {
      const rest = process.argv.slice(5);
      const then: string[] = [];
      const settings: [string, string][] = [];
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--then") then.push(rest[++i]);
        else if (rest[i] === "--setting") {
          const [k, ...v] = rest[++i].split("=");
          settings.push([k, v.join("=")]);
        }
      }
      const started = performance.now();
      await runJob(process.argv[3], JSON.parse(process.argv[4] ?? "{}"), then, settings);
      console.log(`ts ${process.argv[3]} done in ${((performance.now() - started) / 1000).toFixed(2)}s`);
      const { stopExiftool } = await import("./features/tasks/exif");
      stopExiftool();
    } else {
      console.error("usage: cli.ts adopt | run-job <kind> <json> [--then kind] [--setting K=V] | scan [username...] [--full] [--followups] | strip-thumbnail-metadata [--dry-run]");
      process.exit(2);
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
  await client.close();
}
