import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config. `driver: "expo"` makes `drizzle-kit generate` emit both
 * the plain SQL migrations AND a `migrations.js` bundle the expo-sqlite migrator
 * consumes at app start. The SQL files are the single source of truth; the Node
 * test harness applies them directly against better-sqlite3 (see src/db/test-db).
 */
export default defineConfig({
  dialect: "sqlite",
  driver: "expo",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
});
