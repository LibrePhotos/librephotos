/**
 * The desktop's executor for `packages/local-db` (its README, "The executor"; CONTRACT.md "Local
 * database"): the package's `SqlExecutor` over the Rust SQL engine (`db_exec`, `db_batch`). Async
 * everywhere; a transaction never spans two calls, so a write of several statements is one
 * `batch` (atomic), never Drizzle's `db.transaction()`.
 *
 * Rows come back as sqlite-proxy reads them: `all`/`values` an array of row arrays, `get` one row
 * array or undefined, `run` an empty array, with the column names (`all`, `get`) and
 * `changes`/`lastInsertRowId` (`run`). Values are exact: an integer beyond 2^53 is a `bigint`, a
 * blob a `Uint8Array`; parameters take the same (plus booleans, bound as 1/0).
 */
import type { SqlExecutor, SqlMethod, SqlValue } from "@librephotos/local-db";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type { SqlValue };
export type Method = SqlMethod;
export type SqlParam = SqlValue | boolean | undefined;
export type Row = SqlValue[];
export type Statement = { sql: string; params: readonly SqlParam[]; method: Method };
type Meta = { columns?: string[]; changes?: number; lastInsertRowId?: number };
export type ManyResult = Meta & { rows: Row[] };
export type GetResult = Meta & { rows: Row | undefined };
export type ExecResult = ManyResult | GetResult;

// The wire format of `src-tauri/src/localdb/value.rs`: plain JSON, or a one-key tag object.
type Tagged = { $bigint: string } | { $blob: string } | { $real: string };
type Plain = null | number | string;
type WireCell = Plain | Tagged;
type WireParam = Plain | boolean | Tagged;
/** `tagged` is set when some cell is a tag object; without it every cell is plain. */
type WireMany = Meta & { rows: WireCell[][]; tagged?: boolean };
type WireOne = Meta & { rows: WireCell[] | null; tagged?: boolean };
type WireResult = WireMany | WireOne;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeParam(v: SqlParam): WireParam {
  switch (typeof v) {
    case "undefined":
      return null;
    case "number":
      if (Number.isFinite(v)) return v;
      // SQLite stores NaN as NULL.
      return Number.isNaN(v) ? null : { $real: v > 0 ? "Infinity" : "-Infinity" };
    case "bigint":
      return v <= MAX_SAFE && v >= -MAX_SAFE ? Number(v) : { $bigint: v.toString() };
    case "string":
    case "boolean":
      return v;
    default:
      return v === null ? null : { $blob: toBase64(v) };
  }
}

function decodeCell(c: WireCell): SqlValue {
  if (c === null || typeof c !== "object") return c;
  if ("$bigint" in c) return BigInt(c.$bigint);
  if ("$blob" in c) return fromBase64(c.$blob);
  return Number(c.$real);
}

const decodeRow = (r: WireCell[]): Row => r.map(decodeCell);

/** Rust's word that no cell is a tag: the rows are handed on as they came (no copy). */
function allPlain(_rows: WireCell[][], tagged: boolean | undefined): _rows is Plain[][] {
  return !tagged;
}

function meta(w: Meta): Meta {
  const m: Meta = {};
  if (w.columns) m.columns = w.columns;
  if (w.changes !== undefined) m.changes = w.changes;
  if (w.lastInsertRowId !== undefined) m.lastInsertRowId = w.lastInsertRowId;
  return m;
}

function many(w: WireMany): ManyResult {
  return { ...meta(w), rows: allPlain(w.rows, w.tagged) ? w.rows : w.rows.map(decodeRow) };
}

function one(w: WireOne): GetResult {
  return { ...meta(w), rows: w.rows === null ? undefined : decodeRow(w.rows) };
}

/** A batch result answers its statement's method: `get` is one row. */
function isOne(_w: WireResult, method: Method): _w is WireOne {
  return method === "get";
}

function shape(w: WireResult, method: Method): ExecResult {
  return isOne(w, method) ? one(w) : many(w);
}

const utf8 = new TextDecoder();

/**
 * Rust answers with the JSON it wrote while SQLite stepped, as raw bytes. (Handing it over as a
 * script instead, `webview.eval`, measured ~45% slower for a 900 KB page on WebView2.)
 */
async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const bytes = await invoke<ArrayBuffer>(command, args);
  const parsed: T = JSON.parse(utf8.decode(bytes));
  return parsed;
}

function notInTauri(): never {
  throw new Error("the local database needs the desktop app");
}

/** One statement, autocommit. */
export function exec(sql: string, params: readonly SqlParam[], method: "get"): Promise<GetResult>;
export function exec(sql: string, params: readonly SqlParam[], method: "run" | "all" | "values"): Promise<ManyResult>;
export function exec(sql: string, params: readonly SqlParam[], method: Method): Promise<ExecResult>;
export async function exec(sql: string, params: readonly SqlParam[], method: Method): Promise<ExecResult> {
  if (!isTauri()) notInTauri();
  const w = await call<WireResult>("db_exec", { sql, params: params.map(encodeParam), method });
  return shape(w, method);
}

/** Statements in one transaction: every result in order, or a rejection and nothing written. */
export async function batch(statements: readonly Statement[]): Promise<ExecResult[]> {
  if (!isTauri()) notInTauri();
  if (statements.length === 0) return [];
  const wire = statements.map(s => ({ sql: s.sql, params: s.params.map(encodeParam), method: s.method }));
  const results = await call<WireResult[]>("db_batch", { statements: wire });
  return results.map((w, i) => shape(w, statements[i]?.method ?? "all"));
}

export const executor: SqlExecutor = { exec, batch };

export type DbInfo = { path: string | null; applied: string[]; wiped: boolean; migrationError: string | null };

/** Where the database is, which migrations it has, and why the last one failed (if it did). */
export const dbInfo = (): Promise<DbInfo> => (isTauri() ? invoke<DbInfo>("db_info") : notInTauri());

/**
 * Tables written by committed calls, coalesced by Rust into one event per ~40 ms
 * (`db://changed { tables }`). The change hub of the shared package subscribes here.
 */
export function onDbChanged(handler: (tables: string[]) => void): () => void {
  if (!isTauri()) return () => undefined;
  let unlisten: UnlistenFn | null = null;
  let disposed = false;
  void listen<{ tables: string[] }>("db://changed", e => handler(e.payload.tables)).then(fn => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}
