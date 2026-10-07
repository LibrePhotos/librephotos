// Database access. Drizzle over Bun's native Postgres driver (2x the
// throughput of postgres.js here). Two ways in:
//   db    - the Drizzle query builder / relational queries (schema.ts)
//   sql   - Drizzle's `sql` template, run with db.execute(...) for anything
//           the builder can't express nicely (CTEs, window functions, ...)
// Bun's driver parses timestamptz into a JS Date (millisecond precision), so
// API datetimes are formatted in SQL with drfTs()/pyIsoTs() from ./time.
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { sql, type SQL as DSQL } from "drizzle-orm";
import { config } from "./config";
import * as schema from "../db/schema";
import * as relations from "../db/relations";

export const client = new SQL({
  hostname: config.dbHost,
  port: config.dbPort,
  database: config.dbName,
  username: config.dbUser,
  password: config.dbPass,
  max: config.dbPool,
  // No idleTimeout: Bun 1.3 closes pooled connections that are about to be
  // reused ("Idle timeout reached" on an in-flight query) after idle gaps.
  connection: { application_name: "librephotos-ts", TimeZone: "UTC" },
});

export const db = drizzle({ client, schema: { ...schema, ...relations } });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
export { sql };

/** Rows of a raw query (db.execute returns the driver's row array). */
export async function rows<T = Record<string, unknown>>(q: DSQL, tx: Db | Tx = db): Promise<T[]> {
  return (await tx.execute(q)) as unknown as T[];
}

/** First row of a raw query, or undefined. */
export async function row<T = Record<string, unknown>>(q: DSQL, tx: Db | Tx = db): Promise<T | undefined> {
  const r = await rows<T>(q, tx);
  return r[0];
}

/**
 * Any JSON value as a jsonb SQL parameter (safe for scalars too):
 * sql`UPDATE t SET j = ${jsonbParam(v)}`.
 */
export const jsonbParam = (v: unknown) => sql`${JSON.stringify(v)}::text::jsonb`;

/** Postgres array literal text for a raw client`` query: `${arrayLiteral(ids)}::uuid[]`. */
export function arrayLiteral(values: readonly (string | number | boolean | null)[]): string {
  return (
    "{" +
    values
      .map((v) => (v === null ? "NULL" : typeof v === "string" ? '"' + v.replace(/[\\"]/g, (c) => "\\" + c) + '"' : String(v)))
      .join(",") +
    "}"
  );
}

/**
 * A JS array as ONE Postgres array parameter (drizzle's sql template expands
 * a bare array into ($1, $2, ...)): sql`WHERE p.id = ANY(${pgArray(ids, "uuid")})`.
 * Empty arrays are fine.
 */
export const pgArray = (values: readonly (string | number | boolean | null)[], type: string) =>
  sql`${arrayLiteral(values)}::${sql.raw(type)}[]`;
