import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The EXPLAIN budget test seeds 100k rows before it asserts anything.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
