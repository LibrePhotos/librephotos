import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Only the schema barrel: the package root also exports the TanStack
      // hooks, which would drag React in.
      { find: /^@librephotos\/api-client$/, replacement: here("../../../../packages/api-client/src/schemas/index.ts") },
      { find: /^@fe\//, replacement: here("../../../frontend/src/api_client/") },
      { find: /^@api-schemas\//, replacement: here("../../../../packages/api-client/src/schemas/") },
      // The schema files live outside this package and have no node_modules of
      // their own next to them; they must share this package's zod instance.
      { find: /^zod$/, replacement: here("node_modules/zod/index.js") },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Cases hit live servers; keep the per-role token cache in one process.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
