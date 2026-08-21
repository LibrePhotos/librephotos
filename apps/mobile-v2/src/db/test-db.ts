/**
 * Node-side test database. Wraps better-sqlite3 in the drizzle better-sqlite3
 * driver and applies the exact committed migration SQL, so the merged-timeline
 * and index-plan tests run against real SQLite with the real schema — no mocks,
 * no divergence from the expo-sqlite runtime (both are `BaseSQLiteDatabase<"sync">`).
 *
 * This module is imported only by tests / tooling; it is never bundled into the
 * app (the app opens its DB via ./client, which pulls in expo-sqlite instead).
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { schema } from "./schema";
import { MIGRATION_STATEMENTS } from "./migrations-sql";
import type { AppDatabase } from "./types";

export type TestDb = { db: AppDatabase; sqlite: Database.Database; close: () => void };

/** Create a fresh in-memory DB with the full schema applied. */
export function createTestDb(): TestDb {
  const sqlite = new Database(":memory:");
  for (const stmt of MIGRATION_STATEMENTS) sqlite.exec(stmt);
  const db = drizzle(sqlite, { schema }) as unknown as AppDatabase;
  return { db, sqlite, close: () => sqlite.close() };
}
