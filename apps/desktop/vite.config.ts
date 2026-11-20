import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The shared API client (packages/api-client) ships TypeScript source and is compiled into this
// app through an alias, like the web app does (tsconfig.json mirrors it under "paths"). Only its
// React-free `core` entry: the desktop has no React Query. `dedupe` makes the package's bare
// `zod` import resolve to this app's install, not whatever sits above packages/.
const apiClientSrc = fileURLToPath(new URL("../../packages/api-client/src", import.meta.url));
// The shared on-device database (packages/local-db: schema, migrations, queries, writers) the
// same way, over this app's executor (src/db/executor.ts). Its bare `drizzle-orm` import is
// deduped too: one copy of Drizzle's classes in the bundle.
const localDb = fileURLToPath(new URL("../../packages/local-db", import.meta.url));

// Tauri expects a fixed port and must see Rust compile errors, so don't clear the screen.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: [
      { find: /^@librephotos\/api-client\/core$/, replacement: `${apiClientSrc}/core.ts` },
      { find: /^@librephotos\/local-db$/, replacement: `${localDb}/src/index.ts` },
    ],
    dedupe: ["zod", "drizzle-orm"],
  },
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] }, fs: { allow: [".", apiClientSrc, localDb] } },
  build: { target: "es2023", sourcemap: false },
});
