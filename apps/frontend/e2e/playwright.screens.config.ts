import { defineConfig } from "@playwright/test";
import { STORAGE_STATE } from "./playwright.config";

/**
 * The screens run (`yarn screens`): takes the docs and release screenshots listed in
 * screens/manifest.ts against a running LibrePhotos (E2E_BASE_URL, default the e2e stack on
 * http://localhost:8080), in light and dark, and writes them with manifest.json into
 * apps/docs/static/img/shots/. `yarn test` (playwright.config.ts) never runs these.
 *
 * Projects: "setup" logs in (tests/auth.setup.ts, shared with the smoke suite), "screens" takes the
 * shots, "docs-manifest" writes manifest.json after them, and "unit" tests the helpers without a
 * running LibrePhotos (`yarn screens:unit`).
 */
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./screens",
  outputDir: "./test-results/screens",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: isCI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    // Shots show the English UI in UTC, without animations.
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testDir: "./tests", testMatch: /auth\.setup\.ts/, teardown: "docs-manifest" },
    { name: "screens", testMatch: /screens\.spec\.ts/, dependencies: ["setup"], use: { storageState: STORAGE_STATE } },
    { name: "docs-manifest", testMatch: /docs-manifest\.teardown\.ts/ },
    { name: "unit", testMatch: /\.test\.ts/ },
  ],
});
