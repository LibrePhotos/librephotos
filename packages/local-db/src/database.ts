import { NoopLogger } from "drizzle-orm";
import { NoopCache } from "drizzle-orm/cache/core";
import { createTableRelationsHelpers, extractTablesRelationalConfig, type ExtractTablesWithRelations } from "drizzle-orm";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import { SqliteRemoteDatabase, type SqliteRemoteResult } from "drizzle-orm/sqlite-proxy";
import {
  RemotePreparedQuery,
  SQLiteRemoteSession,
  type PreparedQueryConfig,
} from "drizzle-orm/sqlite-proxy/session";
import {
  columnsOf,
  rowToObject,
  rowsOf,
  rowsToObjects,
  toSqlValue,
  type SqlExecutor,
  type SqlMethod,
  type SqlResult,
  type SqlStatement,
} from "./executor";
import { schema, type Schema } from "./schema";

type Tables = ExtractTablesWithRelations<Schema>;

export type AppDatabase = SqliteRemoteDatabase<Schema>;

export type WriteResult = { changes: number; lastInsertRowId: number | null };

type Reply = { rows: unknown[]; result: SqlResult; changes?: number; lastInsertRowId?: number | null };

function isReply(value: unknown): value is Reply {
  return typeof value === "object" && value !== null && "result" in value && isSqlResult(value.result);
}

function isSqlResult(value: unknown): value is SqlResult {
  return typeof value === "object" && value !== null && "rows" in value;
}

function resultOf(rows: unknown, isFromBatch: boolean | undefined): SqlResult | undefined {
  if (isFromBatch) return isReply(rows) ? rows.result : undefined;
  if (Array.isArray(rows)) {
    const first: unknown = rows[0];
    if (isSqlResult(first)) return first;
  }
  return undefined;
}

function statement(sql: string, params: readonly unknown[], method: SqlMethod): SqlStatement {
  return { sql, params: params.map(toSqlValue), method };
}

function reply(result: SqlResult, method: SqlMethod): Reply {
  switch (method) {
    case "run":
      return { rows: [], result, changes: result.changes ?? 0, lastInsertRowId: result.lastInsertRowId ?? null };
    case "values":
      return { rows: rowsOf(result), result };
    case "all":
    case "get":
      return { rows: [result], result };
  }
}

class LocalPreparedQuery<T extends PreparedQueryConfig> extends RemotePreparedQuery<T> {
  private readonly raw: boolean;

  constructor(raw: boolean, ...args: ConstructorParameters<typeof RemotePreparedQuery<T>>) {
    super(...args);
    this.raw = raw;
  }

  override mapAllResult(rows: unknown, isFromBatch?: boolean): unknown {
    const result = resultOf(rows, isFromBatch);
    if (!result) return [];
    return this.raw ? rowsToObjects(result) : super.mapAllResult(rowsOf(result));
  }

  override mapGetResult(rows: unknown, isFromBatch?: boolean): unknown {
    const result = resultOf(rows, isFromBatch);
    const row = result ? rowsOf(result)[0] : undefined;
    if (!result || !row) return undefined;
    return this.raw ? rowToObject(columnsOf(result), row) : super.mapGetResult(row);
  }
}

type PrepareArgs = Parameters<SQLiteRemoteSession<Schema, Tables>["prepareQuery"]>;

class LocalDbSession extends SQLiteRemoteSession<Schema, Tables> {
  private readonly executor: SqlExecutor;

  constructor(executor: SqlExecutor, dialect: SQLiteAsyncDialect) {
    const tablesConfig = extractTablesRelationalConfig<Tables>(schema, createTableRelationsHelpers);
    const relational = { fullSchema: schema, schema: tablesConfig.tables, tableNamesMap: tablesConfig.tableNamesMap };
    super(
      async (sql, params, method) => reply(await executor.exec(sql, statement(sql, params, method).params, method), method),
      dialect,
      relational,
      async (queries) => {
        const statements = queries.map((q) => statement(q.sql, q.params, q.method));
        const results = await executor.batch(statements);
        return results.map((result, i) => reply(result, statements[i]?.method ?? "all"));
      }
    );
    this.executor = executor;
  }

  override prepareQuery<T extends Omit<PreparedQueryConfig, "run">>(
    query: PrepareArgs[0],
    fields: PrepareArgs[1],
    executeMethod: PrepareArgs[2],
    isResponseInArrayMode: PrepareArgs[3],
    customResultMapper?: PrepareArgs[4],
    queryMetadata?: PrepareArgs[5],
    cacheConfig?: PrepareArgs[6]
  ): RemotePreparedQuery<T> {
    const executor = this.executor;
    return new LocalPreparedQuery<T>(
      fields === undefined && customResultMapper === undefined,
      async (sql, params, method) => reply(await executor.exec(sql, statement(sql, params, method).params, method), method),
      query,
      new NoopLogger(),
      new NoopCache(),
      queryMetadata,
      cacheConfig,
      fields,
      executeMethod,
      isResponseInArrayMode,
      customResultMapper
    );
  }

  override extractRawAllValueFromBatchResult(batchReply: unknown): unknown {
    return isReply(batchReply) ? rowsToObjects(batchReply.result) : [];
  }

  override extractRawGetValueFromBatchResult(batchReply: unknown): unknown {
    if (!isReply(batchReply)) return undefined;
    const row = rowsOf(batchReply.result)[0];
    return row ? rowToObject(columnsOf(batchReply.result), row) : undefined;
  }

  override extractRawValuesValueFromBatchResult(batchReply: unknown): unknown {
    return isReply(batchReply) ? rowsOf(batchReply.result) : [];
  }

  override transaction<T>(): Promise<T> {
    return Promise.reject(
      new Error("local-db: interactive transactions are not supported; use db.batch([...]) for atomic writes")
    );
  }
}

export function createDatabase(executor: SqlExecutor): AppDatabase {
  const dialect = new SQLiteAsyncDialect();
  const session = new LocalDbSession(executor, dialect);
  const tablesConfig = extractTablesRelationalConfig<Tables>(schema, createTableRelationsHelpers);
  return new SqliteRemoteDatabase<Schema>("async", dialect, session, {
    fullSchema: schema,
    schema: tablesConfig.tables,
    tableNamesMap: tablesConfig.tableNamesMap,
  });
}

export async function runWrite(db: AppDatabase, query: Parameters<AppDatabase["run"]>[0]): Promise<WriteResult> {
  const result: SqliteRemoteResult = await db.run(query);
  return {
    changes: "changes" in result && typeof result.changes === "number" ? result.changes : 0,
    lastInsertRowId:
      "lastInsertRowId" in result && typeof result.lastInsertRowId === "number" ? result.lastInsertRowId : null,
  };
}
