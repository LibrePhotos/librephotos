/**
 * Migration runner (doc 02 §6), for every runtime.
 *
 * The migrations are `migrations/migrations.json`: an ordered array of
 * `{ tag, statements[] }` built from drizzle-kit's SQL (scripts/build-migrations.mjs).
 * Bookkeeping is one table both runtimes share:
 *
 *   __local_db_migrations(tag TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)
 *
 * A migration is applied by running its statements and inserting its tag in ONE
 * batch, so it lands whole or not at all. Migrations whose tag is already in the
 * table are skipped; order is the array's.
 *
 * If a migration is impossible (a database from an older, squashed schema, a
 * half-written file), the runner falls back to WIPE-AND-REBUILD: the remote
 * mirror is disposable, so only `outbox` and `upload_queue` must survive (auth
 * lives outside the database). Those are read out, every table, view and
 * trigger is dropped, the schema is rebuilt from the migrations, and the
 * preserved rows are put back (columns the new tables no longer have are
 * dropped). The caller re-runs a full seed afterwards.
 *
 * The desktop's Rust side implements the same algorithm against the same file
 * (see README.md), so either app can open a database the other migrated.
 */
import migrationsJson from "../migrations/migrations.json";
import { rowsOf, rowsToObjects, type SqlExecutor, type SqlStatement, type SqlValue } from "./executor";

export type Migration = { tag: string; statements: string[] };

/** Every migration, in order. */
export const MIGRATIONS: readonly Migration[] = migrationsJson;

export const MIGRATIONS_TABLE = "__local_db_migrations";

/** Tables whose rows survive a wipe-and-rebuild. */
export const PRESERVED_TABLES = ["outbox", "upload_queue"] as const;

export type MigrationResult = { applied: string[]; wiped: boolean };

const CREATE_BOOKKEEPING = `CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (tag TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`;

function run(sql: string, params: SqlValue[] = []): SqlStatement {
  return { sql, params, method: "run" };
}

/** The statements that apply `migration` and record it. */
function applyStatements(migration: Migration, now: number): SqlStatement[] {
  return [
    ...migration.statements.map((sql) => run(sql)),
    run(`INSERT INTO \`${MIGRATIONS_TABLE}\` (tag, applied_at) VALUES (?, ?)`, [migration.tag, now]),
  ];
}

async function appliedTags(executor: SqlExecutor): Promise<Set<string>> {
  const result = await executor.exec(`SELECT tag FROM \`${MIGRATIONS_TABLE}\``, [], "all");
  return new Set(rowsOf(result).map((row) => String(row[0])));
}

/** Apply every pending migration; wipe and rebuild if that fails. */
export async function runMigrations(
  executor: SqlExecutor,
  opts: { migrations?: readonly Migration[]; now?: number; onWipe?: (error: unknown) => void } = {}
): Promise<MigrationResult> {
  const migrations = opts.migrations ?? MIGRATIONS;
  const now = opts.now ?? Date.now();
  try {
    await executor.exec(CREATE_BOOKKEEPING, [], "run");
    const done = await appliedTags(executor);
    const applied: string[] = [];
    for (const migration of migrations) {
      if (done.has(migration.tag)) continue;
      await executor.batch(applyStatements(migration, now));
      applied.push(migration.tag);
    }
    return { applied, wiped: false };
  } catch (error) {
    opts.onWipe?.(error);
    await wipeAndRebuild(executor, { migrations, now });
    return { applied: migrations.map((m) => m.tag), wiped: true };
  }
}

type SchemaObject = { type: string; name: string };

/** Every user table, view and virtual table (FTS shadow tables go with their virtual table). */
async function schemaObjects(executor: SqlExecutor): Promise<SchemaObject[]> {
  const result = await executor.exec(
    `SELECT type, name, sql FROM sqlite_master
     WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'`,
    [],
    "all"
  );
  const objects = rowsToObjects(result).map((row) => ({
    type: String(row.type),
    name: String(row.name),
    sql: typeof row.sql === "string" ? row.sql : "",
  }));
  const virtual = objects.filter((o) => /^CREATE VIRTUAL TABLE/i.test(o.sql)).map((o) => o.name);
  // `x_data`, `x_idx`, ... belong to virtual table `x` and are dropped with it.
  const isShadow = (name: string) => virtual.some((v) => name !== v && name.startsWith(`${v}_`));
  return objects.filter((o) => !isShadow(o.name));
}

async function readRows(executor: SqlExecutor, table: string): Promise<Record<string, SqlValue>[]> {
  try {
    return rowsToObjects(await executor.exec(`SELECT * FROM \`${table}\``, [], "all"));
  } catch {
    return []; // the table did not exist
  }
}

async function columnsOf(executor: SqlExecutor, table: string): Promise<Set<string>> {
  const result = await executor.exec(`SELECT name FROM pragma_table_info(?)`, [table], "all");
  return new Set(rowsOf(result).map((row) => String(row[0])));
}

/**
 * Drop everything and rebuild the schema from the migrations, keeping the rows
 * of {@link PRESERVED_TABLES}. Runs as one batch after the reads.
 */
export async function wipeAndRebuild(
  executor: SqlExecutor,
  opts: { migrations?: readonly Migration[]; now?: number } = {}
): Promise<void> {
  const migrations = opts.migrations ?? MIGRATIONS;
  const now = opts.now ?? Date.now();
  const preserved = await Promise.all(PRESERVED_TABLES.map(async (t) => ({ table: t, rows: await readRows(executor, t) })));
  const objects = await schemaObjects(executor);

  const drops: SqlStatement[] = [
    // Views first (they reference tables), then virtual tables (they own shadow tables), then the rest.
    ...objects.filter((o) => o.type === "view").map((o) => run(`DROP VIEW IF EXISTS \`${o.name}\``)),
    ...objects.filter((o) => o.type === "table").map((o) => run(`DROP TABLE IF EXISTS \`${o.name}\``)),
  ];
  const rebuild = migrations.flatMap((m) => applyStatements(m, now));
  // The bookkeeping table is dropped with the rest (it is in sqlite_master too) and starts over.
  await executor.batch([...drops, run(CREATE_BOOKKEEPING), ...rebuild]);

  const restores: SqlStatement[] = [];
  for (const { table, rows } of preserved) {
    if (rows.length === 0) continue;
    const keep = await columnsOf(executor, table);
    for (const row of rows) {
      const cols = Object.keys(row).filter((c) => keep.has(c));
      if (cols.length === 0) continue;
      restores.push(
        run(
          `INSERT OR IGNORE INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
          cols.map((c) => row[c] ?? null)
        )
      );
    }
  }
  if (restores.length > 0) await executor.batch(restores);
}
