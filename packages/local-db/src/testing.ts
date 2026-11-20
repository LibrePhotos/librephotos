/**
 * In-memory test database: real SQLite (better-sqlite3) with the real schema,
 * applied from the same migrations.json every runtime uses, behind the same
 * async executor contract the apps implement. No mocks, so a query passes here
 * exactly when it passes on the phone.
 *
 * `createTestDb()` is synchronous (the schema is applied directly through
 * better-sqlite3), so it fits a plain `beforeEach`. Writes through `db` (or
 * `executor`) are reported to `subscribe` per table, the way the apps' change
 * listeners report them, so live-query code can be tested against it.
 *
 * Test/tooling only: it loads the better-sqlite3 native addon.
 */
import Database from "better-sqlite3";
import { createBetterSqliteExecutor } from "./better-sqlite3";
import { trackChanges, type DbChangeSubscribe } from "./change-hub";
import { createDatabase, type AppDatabase } from "./database";
import type { SqlExecutor } from "./executor";
import { MIGRATIONS, MIGRATIONS_TABLE } from "./migrate";

export type TestDb = {
  db: AppDatabase;
  executor: SqlExecutor;
  /** The raw connection, for assertions that bypass the package (EXPLAIN, counts). */
  sqlite: Database.Database;
  /** Per-table change events for writes made through `db` / `executor`. */
  subscribe: DbChangeSubscribe;
  close: () => void;
};

/** Apply every migration to a raw connection, recording them like runMigrations does. */
export function applyMigrationsSync(sqlite: Database.Database, now = Date.now()): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (tag TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
  const record = sqlite.prepare(`INSERT INTO \`${MIGRATIONS_TABLE}\` (tag, applied_at) VALUES (?, ?)`);
  for (const migration of MIGRATIONS) {
    for (const statement of migration.statements) sqlite.exec(statement);
    record.run(migration.tag, now);
  }
}

/** A fresh in-memory database with the full schema applied. */
export function createTestDb(): TestDb {
  const sqlite = new Database(":memory:");
  applyMigrationsSync(sqlite);
  const tracked = trackChanges(createBetterSqliteExecutor(sqlite));
  return {
    db: createDatabase(tracked.executor),
    executor: tracked.executor,
    sqlite,
    subscribe: tracked.subscribe,
    close: () => sqlite.close(),
  };
}
/**
 * `SELECT COUNT(*) AS c ...` straight on the raw connection, synchronously: for
 * assertions inside a synchronous callback (a progress seam), where the async
 * `db` cannot be awaited.
 */
export function rawCount(t: Pick<TestDb, "sqlite">, countSql: string): number {
  const row: unknown = t.sqlite.prepare(countSql).get();
  return typeof row === "object" && row !== null && "c" in row && typeof row.c === "number" ? row.c : 0;
}

export * from "./fixtures";
