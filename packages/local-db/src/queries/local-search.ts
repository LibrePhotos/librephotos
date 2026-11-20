/**
 * Local full-text search over local assets (FTS5, see
 * migrations/0001_local_search.sql). The index is kept in sync by triggers, so
 * nothing here writes it except {@link rebuildLocalSearch}.
 *
 * A query is split into words the way FTS5's `unicode61` tokenizer splits text;
 * every word must prefix-match one of a file's words: "march 2023", "canon raw",
 * "holiday 2019 heic". Same rules as the desktop's former Rust search.
 */
import { sql, type SQL } from "drizzle-orm";
import { runBatch } from "../batch";
import type { AppDatabase } from "../types";
import { libraryScope, LIBRARY_ASSET_COLUMNS, type LibraryAssetRow, type LibraryScope } from "./library";

/** The words of a query, lower-case, split on anything that is not a letter or digit. */
export function queryWords(query: string): string[] {
  return query
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
}

/** An FTS5 expression where every word prefix-matches (implicit AND), or null for an empty query. */
export function ftsQuery(query: string): string | null {
  const words = queryWords(query);
  return words.length === 0 ? null : words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(" ");
}

export type LocalSearchOptions = LibraryScope & { limit?: number };

/** Local assets matching `query`, newest first. Empty for an empty query. */
export async function searchLocalAssets(
  db: AppDatabase,
  query: string,
  opts: LocalSearchOptions = {}
): Promise<LibraryAssetRow[]> {
  const match = ftsQuery(query);
  if (match == null) return [];
  return db.all<LibraryAssetRow>(
    sql`SELECT ${LIBRARY_ASSET_COLUMNS}
        FROM local_asset_fts JOIN local_asset la ON la.rowid = local_asset_fts.rowid
        WHERE local_asset_fts MATCH ${match} AND ${libraryScope(opts)}
        ORDER BY la.created_at DESC, la.id DESC
        LIMIT ${opts.limit ?? 200}`
  );
}

/** The words a file is indexed under (for tests and the "why did this match" UI). */
export async function localSearchTerms(db: AppDatabase, assetId: string): Promise<string | null> {
  const row = await db.get<{ terms: string } | undefined>(
    sql`SELECT t.terms AS terms FROM local_asset la
        JOIN local_asset_search_terms t ON t.asset_rowid = la.rowid WHERE la.id = ${assetId}`
  );
  return row?.terms ?? null;
}

/** Rebuild the whole index from local_asset (after a VACUUM, which may renumber rowids). */
export function rebuildLocalSearchSql(): SQL[] {
  return [
    sql`DELETE FROM local_asset_fts`,
    sql`INSERT INTO local_asset_fts(rowid, terms) SELECT asset_rowid, terms FROM local_asset_search_terms`,
  ];
}

export async function rebuildLocalSearch(db: AppDatabase): Promise<void> {
  await runBatch(db, rebuildLocalSearchSql());
}
