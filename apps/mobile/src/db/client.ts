/**
 * App-runtime SQLite handle. Opens the one database file with the change
 * listener enabled (drives reactive live queries) and wraps it in the drizzle
 * expo-sqlite driver — the same BaseSQLiteDatabase<"sync"> surface the Node test
 * harness produces, so queries run identically in both.
 */
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { schema } from "./schema";
import type { AppDatabase } from "./types";

export const DB_NAME = "librephotos.db";

let sqlite: SQLiteDatabase | null = null;
let db: AppDatabase | null = null;

/** Open (once) and return the app database + underlying handle. */
export function openDb(): { db: AppDatabase; sqlite: SQLiteDatabase } {
  if (db && sqlite) return { db, sqlite };
  sqlite = openDatabaseSync(DB_NAME, { enableChangeListener: true });
  sqlite.execSync("PRAGMA journal_mode = WAL;");
  db = drizzle(sqlite, { schema }) as unknown as AppDatabase;
  return { db, sqlite };
}
