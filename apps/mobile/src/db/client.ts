/**
 * The phone's {@link SqlExecutor}: expo-sqlite's async API over the one database
 * file, opened with WAL and the change listener (it drives live queries; see
 * DatabaseGate). Everything else (schema, migrations, queries, writers) is
 * @librephotos/local-db, the same code the desktop runs.
 *
 * One connection, so every call goes through a serial queue: a batch's
 * BEGIN ... COMMIT must not interleave with another caller's statement, and
 * expo-sqlite's own withExclusiveTransactionAsync would open a second
 * connection the change listener does not watch. Prepared statements are kept
 * in a small LRU (a seed batch repeats one INSERT a thousand times).
 */
import { openDatabaseAsync, type SQLiteBindValue, type SQLiteDatabase, type SQLiteStatement } from "expo-sqlite";
import {
  createDatabase,
  createSerialQueue,
  type AppDatabase,
  type SqlExecutor,
  type SqlResult,
  type SqlStatement,
  type SqlValue,
} from "@librephotos/local-db";

export const DB_NAME = "librephotos.db";

const STATEMENT_CACHE_SIZE = 64;

type Row = Record<string, SqlValue>;

function bind(value: SqlValue): SQLiteBindValue {
  return typeof value === "bigint" ? Number(value) : value;
}

/** Normalise what expo-sqlite reads back (booleans never come back; bigints are not enabled). */
function cell(value: unknown): SqlValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "bigint") return value;
  return null;
}

/** Build the executor over an open expo-sqlite database. */
export function createExpoExecutor(sqlite: SQLiteDatabase): SqlExecutor {
  const serial = createSerialQueue();
  const statements = new Map<string, SQLiteStatement>();

  async function prepare(sql: string): Promise<SQLiteStatement> {
    const cached = statements.get(sql);
    if (cached) {
      statements.delete(sql);
      statements.set(sql, cached);
      return cached;
    }
    const stmt = await sqlite.prepareAsync(sql);
    statements.set(sql, stmt);
    if (statements.size > STATEMENT_CACHE_SIZE) {
      const oldest = statements.entries().next();
      if (!oldest.done) {
        statements.delete(oldest.value[0]);
        await oldest.value[1].finalizeAsync();
      }
    }
    return stmt;
  }

  async function execute({ sql, params, method }: SqlStatement): Promise<SqlResult> {
    const stmt = await prepare(sql);
    const result = await stmt.executeForRawResultAsync<Row>(params.map(bind));
    try {
      if (method === "run") {
        return { rows: [], changes: result.changes, lastInsertRowId: result.lastInsertRowId };
      }
      const columns = await stmt.getColumnNamesAsync();
      // Every row, "get" too: a RETURNING statement must step to the end to write them all.
      const rows = (await result.getAllAsync()).map((row) => row.map(cell));
      if (method === "get") return { columns, rows: rows[0], changes: result.changes };
      return { columns, rows, changes: result.changes };
    } finally {
      await result.resetAsync();
    }
  }

  return {
    exec: (sql, params, method) => serial(() => execute({ sql, params, method })),
    batch: (batch) =>
      serial(async () => {
        await sqlite.execAsync("BEGIN IMMEDIATE");
        try {
          const results: SqlResult[] = [];
          for (const statement of batch) results.push(await execute(statement));
          await sqlite.execAsync("COMMIT");
          return results;
        } catch (error) {
          await sqlite.execAsync("ROLLBACK").catch(() => undefined);
          throw error;
        }
      }),
  };
}

export type OpenedDb = { db: AppDatabase; executor: SqlExecutor; sqlite: SQLiteDatabase };

let opened: Promise<OpenedDb> | null = null;

/** Open (once) and return the app database, its executor and the raw handle. */
export function openDb(): Promise<OpenedDb> {
  opened ??= (async () => {
    const sqlite = await openDatabaseAsync(DB_NAME, { enableChangeListener: true });
    // WAL: readers never wait for the writer. busy_timeout: a background task's
    // connection and ours wait for each other instead of failing.
    await sqlite.execAsync("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    const executor = createExpoExecutor(sqlite);
    return { db: createDatabase(executor), executor, sqlite };
  })();
  opened.catch(() => {
    opened = null;
  });
  return opened;
}
