import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.LP_DATABASE_URL ?? "postgres://postgres:x@localhost:5433/lp_t_tsschema" },
});
