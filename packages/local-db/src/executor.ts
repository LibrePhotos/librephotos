export type SqlValue = string | number | bigint | Uint8Array | null;

export type SqlMethod = "run" | "all" | "get" | "values";

export type SqlStatement = {
  sql: string;
  params: SqlValue[];
  method: SqlMethod;
};

export type SqlRow = SqlValue[];

type ResultMeta = {
  columns?: string[];
  changes?: number;
  lastInsertRowId?: number;
};

export type SqlManyResult = ResultMeta & { rows: SqlRow[] };
export type SqlGetResult = ResultMeta & { rows: SqlRow | undefined };
export type SqlResult = SqlManyResult | SqlGetResult;

export interface SqlExecutor {
  exec(sql: string, params: SqlValue[], method: SqlMethod): Promise<SqlResult>;
  batch(statements: SqlStatement[]): Promise<SqlResult[]>;
}

export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

export function rowsOf(result: SqlResult): SqlRow[] {
  const { rows } = result;
  if (rows === undefined) return [];
  return isRowList(rows) ? rows : [rows];
}

function isRowList(rows: SqlRow | SqlRow[]): rows is SqlRow[] {
  return rows.length === 0 || Array.isArray(rows[0]);
}

export function columnsOf(result: SqlResult): string[] {
  if (result.columns) return result.columns;
  if (rowsOf(result).length === 0) return [];
  throw new Error("local-db: the executor returned rows without `columns`; raw SQL reads rows by name");
}

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

export function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  if (value instanceof Date) return value.getTime();
  throw new TypeError(`cannot bind a ${typeof value} to SQLite`);
}
