/**
 * App-runtime SQLite handle. Opens the one database file with the change
 * listener enabled (drives reactive live queries) and wraps it in the drizzle
 * expo-sqlite driver — the same BaseSQLiteDatabase<"sync"> surface the Node test
 * harness produces, so queries run identically in both.
 */
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import { drizzle, type ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import { schema, type Schema } from "./schema";

export const DB_NAME = "librephotos.db";

/** The app's database on the expo-sqlite driver; an AppDatabase to the query modules. */
export type ExpoAppDatabase = ExpoSQLiteDatabase<Schema>;

let sqlite: SQLiteDatabase | null = null;
let db: ExpoAppDatabase | null = null;

/** Open (once) and return the app database + underlying handle. */
export function openDb(): { db: ExpoAppDatabase; sqlite: SQLiteDatabase } {
  if (db && sqlite) return { db, sqlite };
  sqlite = openDatabaseSync(DB_NAME, { enableChangeListener: true });
  sqlite.execSync("PRAGMA journal_mode = WAL;");
  db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
