import { defineConfig } from "drizzle-kit";

/**
 * `drizzle-kit generate` writes plain SQL migrations plus the journal into
 * migrations/. `node scripts/build-migrations.mjs` then turns them into
 * migrations/migrations.json, the ordered statement list every runtime
 * applies (the TS runner here, the desktop's Rust side via include_str!).
 * `npm run db:generate` does both.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
