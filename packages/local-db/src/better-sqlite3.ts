/**
 * {@link SqlExecutor} over better-sqlite3, for Node: tests, tooling, scripts.
 * The connection is synchronous, so every call is naturally atomic and isolated;
 * a batch is one better-sqlite3 transaction.
 *
 * Takes an open `Database` rather than opening one, so this module never loads
 * the native addon itself (better-sqlite3 is an optional peer dependency).
 */
import type { Database, Statement } from "better-sqlite3";
import type { SqlExecutor, SqlResult, SqlStatement, SqlValue } from "./executor";

/** Prepared statements by SQL text: a seed batch repeats one INSERT a thousand times. */
const CACHE_SIZE = 256;

function statementCache(db: Database): (sql: string) => Statement<SqlValue[], unknown[]> {
  const cache = new Map<string, Statement<SqlValue[], unknown[]>>();
  return (sql) => {
    let stmt = cache.get(sql);
    if (stmt) {
      // Refresh its place in the LRU order.
      cache.delete(sql);
    } else {
      stmt = db.prepare<SqlValue[], unknown[]>(sql);
      if (cache.size >= CACHE_SIZE) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
    }
    cache.set(sql, stmt);
    return stmt;
  };
}

function execute(
  prepare: (sql: string) => Statement<SqlValue[], unknown[]>,
  { sql, params, method }: SqlStatement
): SqlResult {
  const stmt = prepare(sql);
  if (!stmt.reader) {
    const info = stmt.run(...params);
    return { rows: method === "get" ? undefined : [], changes: info.changes, lastInsertRowId: Number(info.lastInsertRowid) };
  }
  // A reader with RETURNING writes too; `raw()` keeps rows positional.
  const raw = stmt.raw(true);
  const columns = stmt.columns().map((c) => c.name);
  // Step to the end even for "get": an INSERT ... RETURNING writes every row.
  const rows = raw.all(...params).map((row) => (Array.isArray(row) ? row.map(asSqlValue) : []));
  if (method === "get") return { columns, rows: rows[0] };
  return method === "run" ? { rows: [] } : { columns, rows };
}

function asSqlValue(value: unknown): SqlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  return null;
}

export function createBetterSqliteExecutor(db: Database): SqlExecutor {
  const prepare = statementCache(db);
  const batch = db.transaction((statements: SqlStatement[]) => statements.map((s) => execute(prepare, s)));
  return {
    exec: (sql, params, method) => Promise.resolve().then(() => execute(prepare, { sql, params, method })),
    batch: (statements) => Promise.resolve().then(() => batch.immediate(statements)),
  };
}
