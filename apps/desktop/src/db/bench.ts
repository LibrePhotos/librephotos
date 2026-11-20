/**
 * A micro-benchmark of the local database's IPC round trip, run in the real app (over CDP:
 * `await window.__lpDbBench()`). It works on its own table, `__bench_photo` (shaped like
 * mobile's `remote_photo`), and drops it afterwards.
 *
 * Targets: a 5,000-row timeline page < 30 ms, a 2,000-row batch insert < 100 ms.
 */
import { batch, exec, onDbChanged, type SqlParam, type Statement } from "./executor";
import { md5File, readMetadata, walkRoot, type FsEntry } from "./seams";

const COLUMNS = [
  "id",
  "image_hash",
  "owner_id",
  "timestamp",
  "added_on",
  "last_modified",
  "type",
  "rating",
  "is_favorite",
  "hidden",
  "aspect_ratio",
  "latitude",
  "longitude",
  "search_location",
  "bucket_day",
] as const;

const CREATE = `CREATE TABLE __bench_photo (
  id TEXT PRIMARY KEY NOT NULL, image_hash TEXT NOT NULL, owner_id INTEGER NOT NULL,
  timestamp INTEGER, added_on INTEGER NOT NULL, last_modified INTEGER NOT NULL, type TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 0, is_favorite INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
  aspect_ratio REAL, latitude REAL, longitude REAL, search_location TEXT, bucket_day TEXT NOT NULL)`;

function row(i: number): SqlParam[] {
  const ts = 1_600_000_000_000 + i * 60_000;
  return [
    `photo-${i.toString().padStart(8, "0")}-0000-0000-000000000000`,
    `${(i * 2654435761).toString(16).padStart(32, "0").slice(0, 32)}1`,
    1,
    ts,
    ts + 5000,
    ts + 9000,
    i % 17 === 0 ? "video" : "photo",
    i % 6,
    i % 11 === 0,
    false,
    1.5,
    48.1 + (i % 100) / 1000,
    11.5 + (i % 100) / 1000,
    i % 3 === 0 ? "Munich, Bavaria, Germany" : null,
    new Date(ts).toISOString().slice(0, 10),
  ];
}

const insertOne = `INSERT INTO __bench_photo (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`;

function insertMany(from: number, n: number): Statement {
  const values = Array.from({ length: n }, () => `(${COLUMNS.map(() => "?").join(", ")})`).join(", ");
  const params = Array.from({ length: n }, (_, k) => row(from + k)).flat();
  return { sql: `INSERT INTO __bench_photo (${COLUMNS.join(", ")}) VALUES ${values}`, params, method: "run" };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
};

async function time(runs: number, f: (run: number) => Promise<unknown>): Promise<{ median: number; min: number; max: number }> {
  const ms: number[] = [];
  for (let r = 0; r < runs; r++) {
    const t = performance.now();
    await f(r);
    ms.push(performance.now() - t);
  }
  const round = (x: number) => Math.round(x * 100) / 100;
  return { median: round(median(ms)), min: round(Math.min(...ms)), max: round(Math.max(...ms)) };
}

/** Writes in a burst, then counts the `db://changed` events and the delay of the first. */
async function changeEvents(): Promise<Record<string, unknown>> {
  const events: { at: number; tables: string[] }[] = [];
  const stop = onDbChanged(tables => events.push({ at: performance.now(), tables }));
  // The listener is registered asynchronously; earlier writes' events may still arrive.
  await new Promise(r => setTimeout(r, 300));
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) {
    await exec("UPDATE __bench_photo SET rating = ? WHERE id = ?", [i % 6, row(i).at(0) ?? null], "run");
  }
  const writesMs = performance.now() - t0;
  await new Promise(r => setTimeout(r, 300));
  stop();
  const mine = events.filter(e => e.at >= t0);
  const first = mine[0];
  return {
    writes: 20,
    writesMs: Math.round(writesMs),
    events: mine.length,
    tables: first?.tables ?? [],
    firstEventAfterMs: first ? Math.round(first.at - t0) : null,
  };
}

/** Walk, metadata and MD5 of a folder (test corpus copies only). */
async function seams(root: string): Promise<Record<string, unknown>> {
  const files: FsEntry[] = [];
  let batches = 0;
  const t0 = performance.now();
  const total = await walkRoot(root, b => {
    batches++;
    files.push(...b);
  });
  const walkMs = performance.now() - t0;
  const t1 = performance.now();
  const metas = await readMetadata(files.map(f => f.path));
  const metaMs = performance.now() - t1;
  const t2 = performance.now();
  const first = files[0];
  const md5 = first ? await md5File(first.path) : null;
  return {
    total,
    batches,
    walkMs: Math.round(walkMs),
    metaMs: Math.round(metaMs),
    withMeta: metas.filter(m => m !== null).length,
    sampleMeta: metas.find(m => m !== null) ?? null,
    md5Ms: Math.round(performance.now() - t2),
    md5,
  };
}

export async function runDbBench(opts: { walkRoot?: string } = {}): Promise<Record<string, unknown>> {
  await batch([
    { sql: "DROP TABLE IF EXISTS __bench_photo", params: [], method: "run" },
    { sql: CREATE, params: [], method: "run" },
    { sql: "CREATE INDEX __bench_photo_ts ON __bench_photo (timestamp)", params: [], method: "run" },
  ]);
  let next = 0;
  // 2,000 single-row INSERTs in one transaction (one IPC call).
  const batchOf2000Statements = await time(5, async () => {
    const stmts: Statement[] = Array.from({ length: 2000 }, () => ({ sql: insertOne, params: row(next++), method: "run" }));
    await batch(stmts);
  });
  // 2,000 rows as one multi-row INSERT (30,000 parameters).
  const multiRowInsertOf2000 = await time(5, async () => {
    await batch([insertMany(next, 2000)]);
    next += 2000;
  });
  // Fill up to 50,000 rows for the reads.
  while (next < 50_000) {
    await batch([insertMany(next, 2000)]);
    next += 2000;
  }
  // A timeline page is keyset-paged: the 5,000 rows before the last one shown.
  const page = `SELECT ${COLUMNS.join(", ")} FROM __bench_photo WHERE hidden = 0 AND timestamp < ? ORDER BY timestamp DESC LIMIT 5000`;
  const before = (r: number) => 1_600_000_000_000 + (next - r * 5000) * 60_000;
  const timelinePage5000All = await time(10, r => exec(page, [before(r)], "all"));
  const timelinePage5000Values = await time(10, r => exec(page, [before(r)], "values"));
  const sample = await exec(page, [before(0)], "all");
  const getById = await time(200, r => exec("SELECT * FROM __bench_photo WHERE id = ?", [row(r * 7).at(0) ?? null], "get"));
  const countAll = await time(20, () => exec("SELECT COUNT(*) FROM __bench_photo", [], "get"));
  const updateOne = await time(100, r => exec("UPDATE __bench_photo SET rating = ? WHERE id = ?", [r % 6, row(r).at(0) ?? null], "run"));
  const changes = await changeEvents();
  const bigint = await exec("SELECT ?, ?, typeof(?)", [2n ** 62n, new Uint8Array([0, 1, 255]), 2n ** 62n], "get");
  await exec("DROP TABLE __bench_photo", [], "run");
  const result = {
    changes,
    roundTripValues: bigint.rows?.map(v => (v instanceof Uint8Array ? `Uint8Array[${v.join(",")}]` : typeof v === "bigint" ? `${v}n` : v)),
    seams: opts.walkRoot ? await seams(opts.walkRoot) : null,
    rows: next,
    pageRows: sample.rows.length,
    pageColumns: sample.rows[0]?.length ?? 0,
    batchOf2000Statements,
    multiRowInsertOf2000,
    timelinePage5000All,
    timelinePage5000Values,
    getById,
    countAll,
    updateOne,
  };
  console.info("[db bench]", JSON.stringify(result));
  return result;
}
