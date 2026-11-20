/**
 * The one seam between the shared database code and a platform's SQLite.
 *
 * Every runtime (expo-sqlite on the phone, rusqlite behind Tauri IPC on the
 * desktop, better-sqlite3 in Node tests) implements this interface and nothing
 * else. Queries, writers, migrations and the change hub are written once, in
 * this package, against it. Keep it this small: every method here is one more
 * thing the Rust side has to implement and keep in step.
 *
 * ## Contract
 *
 * - `exec(sql, params, method)` runs ONE statement.
 *   - `params` are positional (`?`) values, already normalised to {@link SqlValue}.
 *   - `method` says what the caller wants back, in Drizzle sqlite-proxy's shapes:
 *     - `"run"`: `{ rows: [] }`; report `changes` / `lastInsertRowId` when known.
 *     - `"all"` / `"values"`: `{ rows: Row[] }`, every result row.
 *     - `"get"`: `{ rows: Row | undefined }`, the first row or undefined. The
 *       statement still steps to the end (an `INSERT ... RETURNING` writes every row).
 *   - A Row is a POSITIONAL array, never an object: positional rows keep
 *     duplicate column names apart and are what Drizzle's query builder maps.
 *   - `columns`: the statement's column names in SELECT order. Required for
 *     `"all"` and `"get"`: every query in this package is raw SQL whose rows are
 *     read by name, and only the engine knows the names (`sqlite3_column_name`).
 *   - A statement with `RETURNING` is sent with `"all"` or `"get"`; it writes AND returns rows.
 * - `batch(statements)` runs the statements in order inside ONE transaction and
 *   returns one result per statement. It is all-or-nothing: if any statement
 *   fails, everything it did is rolled back and the promise rejects. No other
 *   `exec`/`batch` call may interleave with it on the same connection.
 *
 * There is deliberately no "begin a transaction and hand it back" call: an async
 * executor shared by concurrent callers cannot hold a transaction open while
 * other callers keep issuing statements. Atomic writes are a batch. A
 * read-then-write that must be atomic is one statement (`UPDATE ... WHERE id =
 * (SELECT ...) RETURNING ...`).
 */

/** A value SQLite can bind and return. Booleans are bound as 0 / 1 before they get here. */
export type SqlValue = string | number | bigint | Uint8Array | null;

/** What the caller wants back from a statement (Drizzle's sqlite-proxy methods). */
export type SqlMethod = "run" | "all" | "get" | "values";

export type SqlStatement = {
  sql: string;
  params: SqlValue[];
  method: SqlMethod;
};

/** One result row, positional (column `i` is `columns[i]`). */
export type SqlRow = SqlValue[];

type ResultMeta = {
  /** Column names in result order (required for "all" and "get"; see above). */
  columns?: string[];
  /** Rows changed by a write, when the driver reports it. */
  changes?: number;
  /** Rowid of the last INSERT, when the driver reports it. */
  lastInsertRowId?: number;
};

/** "run" / "all" / "values": every row (none for "run"). */
export type SqlManyResult = ResultMeta & { rows: SqlRow[] };
/** "get": the first row, or undefined. */
export type SqlGetResult = ResultMeta & { rows: SqlRow | undefined };
export type SqlResult = SqlManyResult | SqlGetResult;

export interface SqlExecutor {
  exec(sql: string, params: SqlValue[], method: SqlMethod): Promise<SqlResult>;
  batch(statements: SqlStatement[]): Promise<SqlResult[]>;
}


/**
 * Run async tasks one at a time, in call order. For executors over a single
 * async connection (expo-sqlite): wrapping every `exec` and `batch` in it is
 * what keeps a batch's BEGIN ... COMMIT from interleaving with other callers'
 * statements. A failed task does not stop the queue.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    // The next task waits for this one to settle either way.
    tail = run.catch(() => undefined);
    return run;
  };
}

/** The rows of a result as a list, whatever the method's shape. */
export function rowsOf(result: SqlResult): SqlRow[] {
  const { rows } = result;
  if (rows === undefined) return [];
  return isRowList(rows) ? rows : [rows];
}

/** A "get" row is an array of values (never arrays); a list is an array of arrays. */
function isRowList(rows: SqlRow | SqlRow[]): rows is SqlRow[] {
  return rows.length === 0 || Array.isArray(rows[0]);
}

/** The column names a result must carry to be read by name. */
export function columnsOf(result: SqlResult): string[] {
  if (result.columns) return result.columns;
  if (rowsOf(result).length === 0) return [];
  throw new Error("local-db: the executor returned rows without `columns`; raw SQL reads rows by name");
}

/** Turn positional rows into objects keyed by column name (a later duplicate name wins). */
export function rowsToObjects(result: SqlResult): Record<string, SqlValue>[] {
  const columns = columnsOf(result);
  return rowsOf(result).map((row) => rowToObject(columns, row));
}

export function rowToObject(columns: readonly string[], row: readonly SqlValue[]): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  columns.forEach((name, i) => {
    out[name] = row[i] ?? null;
  });
  return out;
}

/** Normalise a value Drizzle hands us to something every driver binds the same way. */
export function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  if (value instanceof Date) return value.getTime();
  throw new TypeError(`cannot bind a ${typeof value} to SQLite`);
}
