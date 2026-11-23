import { sql, type SQL } from "drizzle-orm";
import { runBatch } from "../batch";
import type { AppDatabase } from "../types";
import { libraryScope, LIBRARY_ASSET_COLUMNS, type LibraryAssetRow, type LibraryScope } from "./library";

export function queryWords(query: string): string[] {
  return query
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
}

export function ftsQuery(query: string): string | null {
  const words = queryWords(query);
  return words.length === 0 ? null : words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(" ");
}

export type LocalSearchOptions = LibraryScope & { limit?: number };

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

export async function localSearchTerms(db: AppDatabase, assetId: string): Promise<string | null> {
  const row = await db.get<{ terms: string } | undefined>(
    sql`SELECT t.terms AS terms FROM local_asset la
        JOIN local_asset_search_terms t ON t.asset_rowid = la.rowid WHERE la.id = ${assetId}`
  );
  return row?.terms ?? null;
}

export function rebuildLocalSearchSql(): SQL[] {
  return [
    sql`DELETE FROM local_asset_fts`,
    sql`INSERT INTO local_asset_fts(rowid, terms) SELECT asset_rowid, terms FROM local_asset_search_terms`,
  ];
}

export async function rebuildLocalSearch(db: AppDatabase): Promise<void> {
  await runBatch(db, rebuildLocalSearchSql());
}
