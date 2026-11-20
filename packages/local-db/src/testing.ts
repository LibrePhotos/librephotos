import Database from "better-sqlite3";
import { createBetterSqliteExecutor } from "./better-sqlite3";
import { trackChanges, type DbChangeSubscribe } from "./change-hub";
import { createDatabase, type AppDatabase } from "./database";
import type { SqlExecutor } from "./executor";
import { MIGRATIONS, MIGRATIONS_TABLE } from "./migrate";

export type TestDb = {
  db: AppDatabase;
  executor: SqlExecutor;
  sqlite: Database.Database;
  subscribe: DbChangeSubscribe;
  close: () => void;
};

export function applyMigrationsSync(sqlite: Database.Database, now = Date.now()): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (tag TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
  const record = sqlite.prepare(`INSERT INTO \`${MIGRATIONS_TABLE}\` (tag, applied_at) VALUES (?, ?)`);
  for (const migration of MIGRATIONS) {
    for (const statement of migration.statements) sqlite.exec(statement);
    record.run(migration.tag, now);
  }
}

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
export function rawCount(t: Pick<TestDb, "sqlite">, countSql: string): number {
  const row: unknown = t.sqlite.prepare(countSql).get();
  return typeof row === "object" && row !== null && "c" in row && typeof row.c === "number" ? row.c : 0;
}

export * from "./fixtures";
